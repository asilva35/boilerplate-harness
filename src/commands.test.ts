import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { clear as clearDebugLog, isEnabled as isDebugEnabled, record, setEnabled as setDebugEnabled } from "./debug.js";
import { MockProvider } from "./provider/mock.js";
import { ToolRegistry } from "./tools/registry.js";

// debug.ts is a module-level singleton - reset it before every test in
// this file so /debug tests don't leak state into each other or into the
// unrelated tests above them.
beforeEach(() => {
  setDebugEnabled(false);
  clearDebugLog();
});

function loggingContext(agent: Agent) {
  const logs: string[] = [];
  let refreshCount = 0;
  return {
    ctx: {
      agent,
      log: (text: string) => logs.push(text),
      refreshHistory: () => refreshCount++,
    },
    logs,
    refreshCount: () => refreshCount,
  };
}

test("a line without a leading slash is not a command", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  assert.equal(await runCommand("hello there", ctx), false);
  assert.deepEqual(logs, []);
});

test("/help logs the command list through ctx.log, not console.log", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  assert.equal(await runCommand("/help", ctx), true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /available commands:/);
  assert.match(logs[0], /\/compact/);
});

test("an unknown command reports itself through ctx.log", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  assert.equal(await runCommand("/bogus", ctx), true);
  assert.deepEqual(logs, ["unknown command: /bogus (try /help)"]);
});

test("/clear empties the message history and refreshes before logging", async () => {
  const agent = new Agent({
    provider: new MockProvider([{ content: [{ type: "text", text: "hi" }], stopReason: "end_turn" }]),
    tools: new ToolRegistry(),
  });
  await agent.send("hello");
  assert.ok(agent.getMessages().length > 0);

  const { ctx, logs, refreshCount } = loggingContext(agent);
  await runCommand("/clear", ctx);

  assert.deepEqual(agent.getMessages(), []);
  assert.equal(refreshCount(), 1);
  assert.deepEqual(logs, ["conversation reset"]);
});

test("/history summarizes every message through a single ctx.log call", async () => {
  const agent = new Agent({
    provider: new MockProvider([{ content: [{ type: "text", text: "hi there" }], stopReason: "end_turn" }]),
    tools: new ToolRegistry(),
  });
  await agent.send("hello");

  const { ctx, logs } = loggingContext(agent);
  await runCommand("/history", ctx);

  assert.equal(logs.length, 1);
  assert.match(logs[0], /2 messages in history:/);
  assert.match(logs[0], /\[user] hello/);
  assert.match(logs[0], /\[assistant] hi there/);
});

test("/compact replaces the messages, refreshes before logging the new count", async () => {
  const agent = new Agent({
    provider: new MockProvider([{ content: [{ type: "text", text: "hi" }], stopReason: "end_turn" }]),
    tools: new ToolRegistry(),
  });
  await agent.send("hello");
  const before = agent.getMessages().length;

  const { ctx, logs, refreshCount } = loggingContext(agent);
  await runCommand("/compact none", ctx);

  assert.equal(refreshCount(), 1);
  assert.deepEqual(logs, [`compacted: ${before} → ${before} messages`]);
});

test("/compact with an unknown strategy logs an error and never mutates or refreshes", async () => {
  const agent = new Agent({
    provider: new MockProvider([{ content: [{ type: "text", text: "hi" }], stopReason: "end_turn" }]),
    tools: new ToolRegistry(),
  });
  await agent.send("hello");
  const before = agent.getMessages();

  const { ctx, logs, refreshCount } = loggingContext(agent);
  await runCommand("/compact bogus", ctx);

  assert.deepEqual(agent.getMessages(), before);
  assert.equal(refreshCount(), 0);
  assert.deepEqual(logs, ["unknown strategy: bogus (try sliding, none, or summarize)"]);
});

test("/compact summarize asks the agent's own provider and replaces the whole history with a synthetic summary", async () => {
  const agent = new Agent({
    provider: new MockProvider([
      { content: [{ type: "text", text: "hi" }], stopReason: "end_turn" },
      { content: [{ type: "text", text: "earlier the user said hello" }], stopReason: "end_turn" },
    ]),
    tools: new ToolRegistry(),
  });
  await agent.send("hello");

  const { ctx, logs, refreshCount } = loggingContext(agent);
  await runCommand("/compact summarize", ctx);

  const after = agent.getMessages();
  assert.equal(after.length, 1);
  assert.match((after[0].content[0] as { text: string }).text, /^\[earlier conversation summary\]/);
  assert.equal(refreshCount(), 1);
  assert.deepEqual(logs, ["compacted: 2 → 1 messages"]);
});

test("/debug with no argument toggles on/off, reporting the new state", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/debug", ctx);
  assert.equal(isDebugEnabled(), true);
  assert.deepEqual(logs, ["debug: on"]);

  await runCommand("/debug", ctx);
  assert.equal(isDebugEnabled(), false);
  assert.deepEqual(logs, ["debug: on", "debug: off"]);
});

test("/debug on and /debug off set the state explicitly, idempotently", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/debug on", ctx);
  await runCommand("/debug on", ctx);
  assert.equal(isDebugEnabled(), true);

  await runCommand("/debug off", ctx);
  assert.equal(isDebugEnabled(), false);
  assert.deepEqual(logs, ["debug: on", "debug: on", "debug: off"]);
});

test("/debug clear empties the ring and logs a confirmation", async () => {
  setDebugEnabled(true);
  record("tool", "info", "will be cleared");
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/debug clear", ctx);

  assert.deepEqual(logs, ["debug log cleared"]);
  await runCommand("/debug ls", ctx);
  assert.equal(logs[1], "debug log is empty");
});

test("/debug ls lists recorded events with a payload marker, empty ring says so", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/debug ls", ctx);
  assert.deepEqual(logs, ["debug log is empty"]);

  // Note: ids are assigned by a monotonic counter that clear() (like Go's
  // Clear()) deliberately does not reset - so these are NOT necessarily
  // #1/#2. Capture the real ids instead of assuming where the counter is.
  setDebugEnabled(true);
  const id1 = record("tool", "info", "no payload");
  const id2 = record("provider", "info", "has one", "the payload");

  await runCommand("/debug ls", ctx);
  const listing = logs[1];
  assert.match(listing, new RegExp(`#${id1}\\b`));
  assert.match(listing, /\btool\b/);
  assert.match(listing, /no payload/);
  assert.match(listing, new RegExp(`• #${id2}\\b`));
  assert.match(listing, /\bprovider\b/);
  assert.match(listing, /has one/);
  assert.match(listing, /2 events/);
});

test("/debug show with no id shows the latest event with a payload", async () => {
  setDebugEnabled(true);
  record("tool", "info", "no payload");
  const id2 = record("provider", "info", "has one", "the actual payload content");
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/debug show", ctx);

  assert.match(logs[0], new RegExp(`#${id2}\\b`));
  assert.match(logs[0], /has one/);
  assert.match(logs[0], /the actual payload content/);
});

test("/debug show <id> shows that specific event, or an error if it's not there", async () => {
  setDebugEnabled(true);
  const id = record("tool", "info", "findable event", "payload here");
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand(`/debug show ${id}`, ctx);
  assert.match(logs[0], /findable event/);
  assert.match(logs[0], /payload here/);

  await runCommand("/debug show 99999", ctx);
  assert.match(logs[1], /no event with id #99999/);

  await runCommand("/debug show notanumber", ctx);
  assert.match(logs[2], /not a valid id: notanumber/);
});

test("/debug with an unrecognized verb reports itself and doesn't change state", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/debug bogus", ctx);

  assert.equal(isDebugEnabled(), false);
  assert.deepEqual(logs, ["unknown value: bogus (try on/off/clear/ls/show)"]);
});

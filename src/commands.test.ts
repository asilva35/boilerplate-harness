import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { MockProvider } from "./provider/mock.js";
import { ToolRegistry } from "./tools/registry.js";

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

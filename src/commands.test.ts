import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "./agent.js";
import type { CommandContext } from "./commands.js";
import { runCommand } from "./commands.js";
import { clear as clearDebugLog, isEnabled as isDebugEnabled, record, setEnabled as setDebugEnabled } from "./debug.js";
import { MockProvider } from "./provider/mock.js";
import type { Provider } from "./provider/types.js";
import { ToolRegistry } from "./tools/registry.js";

// debug.ts is a module-level singleton - reset it before every test in
// this file so /debug tests don't leak state into each other or into the
// unrelated tests above them.
beforeEach(() => {
  setDebugEnabled(false);
  clearDebugLog();
});

// Phase 25: a working (not just type-satisfying) switchProvider stub - a
// real MockProvider stands in for "a whole new backend," so /provider
// tests can assert agent.provider actually changed. Tests that care about
// the exact call args capture them via the returned `switches` array
// instead of overriding this default.
//
// Phase 31: `rollbackAvailable` seeds which paths a fake `ctx.rollback`
// reports finding a backup for - defaults to none, so /rollback tests opt
// in explicitly rather than relying on the real backupStore singleton
// (backup/store.ts is its own dedicated test suite; this file only needs
// to verify cmdRollback's own message-formatting logic).
function loggingContext(agent: Agent, rollbackAvailable: Set<string> = new Set()) {
  const logs: string[] = [];
  let refreshCount = 0;
  const switches: { name: string; model?: string }[] = [];
  const rollbacks: string[] = [];
  return {
    ctx: {
      agent,
      log: (text: string) => logs.push(text),
      refreshHistory: () => refreshCount++,
      switchProvider: (name: string, model?: string): Provider => {
        switches.push({ name, model });
        const provider = new MockProvider([]);
        if (model) provider.setModel(model);
        agent.provider = provider;
        return provider;
      },
      rollback: async (path: string): Promise<boolean> => {
        rollbacks.push(path);
        return rollbackAvailable.has(path);
      },
    } as CommandContext,
    logs,
    refreshCount: () => refreshCount,
    switches,
    rollbacks,
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

test("/tokens reports cumulative usage and estimated cost from the agent's provider", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "hi" }], stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 } },
  ]);
  const agent = new Agent({ provider, tools: new ToolRegistry() });
  await agent.send("hello");

  const { ctx, logs } = loggingContext(agent);
  await runCommand("/tokens", ctx);

  assert.equal(logs.length, 1);
  assert.match(logs[0], /session usage:/);
  assert.match(logs[0], /input\s+100/);
  assert.match(logs[0], /output\s+50/);
  assert.match(logs[0], /est\. cost\s+\$0\.0002/); // (100*1 + 50*2) / 1_000_000
});

test("/tokens shows cached tokens only when there are any", async () => {
  const noCache = new Agent({
    provider: new MockProvider([
      { content: [{ type: "text", text: "hi" }], stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 } },
    ]),
    tools: new ToolRegistry(),
  });
  await noCache.send("hello");
  const { ctx: ctx1, logs: logs1 } = loggingContext(noCache);
  await runCommand("/tokens", ctx1);
  assert.doesNotMatch(logs1[0], /cached/);

  const withCache = new Agent({
    provider: new MockProvider([
      { content: [{ type: "text", text: "hi" }], stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 3 } },
    ]),
    tools: new ToolRegistry(),
  });
  await withCache.send("hello");
  const { ctx: ctx2, logs: logs2 } = loggingContext(withCache);
  await runCommand("/tokens", ctx2);
  assert.match(logs2[0], /cached\s+3/);
});

test("/stats with no ctx.listSessions falls back to the same output as /tokens", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "hi" }], stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 } },
  ]);
  const agent = new Agent({ provider, tools: new ToolRegistry() });
  await agent.send("hello");

  const { ctx: statsCtx, logs: statsLogs } = loggingContext(agent);
  await runCommand("/stats", statsCtx);
  const { ctx: tokensCtx, logs: tokensLogs } = loggingContext(agent);
  await runCommand("/tokens", tokensCtx);

  assert.deepEqual(statsLogs, tokensLogs);
});

test("/stats with ctx.listSessions lists every session, not just the current one", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);
  ctx.listSessions = () => [
    {
      id: "alice",
      userId: "local",
      role: "admin",
      profile: "default",
      kind: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 1000, outputTokens: 500, cachedTokens: 0 },
      estimatedCostUSD: 0.0105,
      lastMessage: "[assistant] hi there",
    },
    {
      id: "bob",
      userId: "local",
      role: "client",
      profile: "readonly",
      kind: "openrouter",
      model: "anthropic/claude-haiku-4.5",
      usage: { inputTokens: 200, outputTokens: 50, cachedTokens: 0 },
      estimatedCostUSD: -1,
      lastMessage: "(no messages yet)",
    },
  ];

  await runCommand("/stats", ctx);

  assert.equal(logs.length, 1);
  assert.match(logs[0], /2 sessions:/);
  assert.match(logs[0], /alice.*user=local role=admin profile=default.*anthropic\/claude-sonnet-4-6/);
  assert.match(logs[0], /in=1,000 out=500 cost=\$0\.0105/);
  assert.match(logs[0], /last: \[assistant] hi there/);
  assert.match(logs[0], /bob.*cost=\(unknown model — no rate\)/);
});

test("/stats with ctx.listSessions returning no sessions reports that instead of an empty list", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);
  ctx.listSessions = () => [];

  await runCommand("/stats", ctx);

  assert.deepEqual(logs, ["no sessions"]);
});

test("/model with no argument shows the current model and provider kind", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/model", ctx);

  assert.match(logs[0], /current: mock\s+\(mock\)/);
});

test("/model <name> sets the model on the agent's current provider, in place", async () => {
  const provider = new MockProvider([]);
  const agent = new Agent({ provider, tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/model claude-opus-4-6", ctx);

  assert.equal(provider.model, "claude-opus-4-6");
  assert.equal(agent.provider, provider); // same instance - /model never swaps the provider object
  assert.deepEqual(logs, ["model: claude-opus-4-6"]);
});

test("/provider with no argument shows the current provider and model", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);

  await runCommand("/provider", ctx);

  assert.match(logs[0], /current: mock\s+\(model: mock\)/);
});

test("/provider <name> [model] delegates to ctx.switchProvider and reports the result", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs, switches } = loggingContext(agent);
  const before = agent.provider;

  await runCommand("/provider anthropic claude-haiku-4-5", ctx);

  assert.deepEqual(switches, [{ name: "anthropic", model: "claude-haiku-4-5" }]);
  assert.notEqual(agent.provider, before); // switchProvider swapped the whole object
  assert.deepEqual(logs, ["provider: mock  (model: claude-haiku-4-5)"]); // "mock" - the stub always returns a MockProvider
});

test("/provider reports ctx.switchProvider's error instead of throwing", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent);
  ctx.switchProvider = () => {
    throw new Error("Unknown provider \"bogus\"");
  };

  await runCommand("/provider bogus", ctx);

  assert.deepEqual(logs, ['provider: Unknown provider "bogus"']);
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

test("/rollback with no path shows usage and never calls ctx.rollback", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs, rollbacks } = loggingContext(agent);

  await runCommand("/rollback", ctx);

  assert.deepEqual(logs, ["usage: /rollback <path>"]);
  assert.deepEqual(rollbacks, []);
});

test("/rollback <path> restores and reports success when ctx.rollback finds a backup", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs, rollbacks } = loggingContext(agent, new Set(["src/foo.ts"]));

  await runCommand("/rollback src/foo.ts", ctx);

  assert.deepEqual(rollbacks, ["src/foo.ts"]);
  assert.deepEqual(logs, ["restored src/foo.ts from its most recent backup"]);
});

test("/rollback <path> reports no backup found, distinct from a restored message", async () => {
  const agent = new Agent({ provider: new MockProvider([]), tools: new ToolRegistry() });
  const { ctx, logs } = loggingContext(agent); // rollbackAvailable defaults to empty

  await runCommand("/rollback src/never-written.ts", ctx);

  assert.match(logs[0], /no backup found for src\/never-written\.ts/);
});

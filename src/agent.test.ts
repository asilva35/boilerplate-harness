import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Agent } from "./agent.js";
import { clear as clearDebugLog, setEnabled as setDebugEnabled, snapshot as debugSnapshot } from "./debug.js";
import { MockProvider } from "./provider/mock.js";
import { ToolRegistry } from "./tools/registry.js";
import type { Tool, ToolResult } from "./tools/types.js";

// debug.ts is a module-level singleton - reset it before every test so
// the debug-log tests below (and the ones above them) don't leak state.
beforeEach(() => {
  setDebugEnabled(false);
  clearDebugLog();
});

const echoTool: Tool<{ text: string }> = {
  name: "echo",
  description: "Echoes back the given text.",
  schema: z.object({ text: z.string() }),
  execute({ text }): ToolResult {
    return { result: text, isError: false };
  },
};

const riskyTool: Tool<{ text: string }> = {
  name: "risky",
  description: "A tool that requires confirmation.",
  schema: z.object({ text: z.string() }),
  requiresConfirmation: true,
  execute({ text }): ToolResult {
    return { result: `did risky thing: ${text}`, isError: false };
  },
};

function registryWith(...tools: Tool[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  return registry;
}

test("returns plain text when the model makes no tool calls", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "hello there" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({ provider, tools: registryWith() });

  const result = await agent.send("hi");

  assert.equal(result, "hello there");
});

test("executes a tool call and feeds the result back to the provider", async () => {
  const provider = new MockProvider([
    {
      content: [
        { type: "tool_use", toolUseId: "1", toolName: "echo", toolInput: JSON.stringify({ text: "ping" }) },
      ],
      stopReason: "tool_use",
    },
    { content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({ provider, tools: registryWith(echoTool) });

  const result = await agent.send("echo ping");

  assert.equal(result, "done");
  const secondCallMessages = provider.calls[1].messages;
  const lastMessage = secondCallMessages[secondCallMessages.length - 1];
  assert.equal(lastMessage.role, "user");
  assert.deepEqual(lastMessage.content, [
    { type: "tool_result", toolUseId: "1", toolResult: "ping", isError: false },
  ]);
});

test("a denied confirmation short-circuits the tool call", async () => {
  const provider = new MockProvider([
    {
      content: [
        { type: "tool_use", toolUseId: "1", toolName: "risky", toolInput: JSON.stringify({ text: "boom" }) },
      ],
      stopReason: "tool_use",
    },
    { content: [{ type: "text", text: "ok, skipped it" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({
    provider,
    tools: registryWith(riskyTool),
    confirm: async () => false,
  });

  const result = await agent.send("do the risky thing");

  assert.equal(result, "ok, skipped it");
  const secondCallMessages = provider.calls[1].messages;
  const lastMessage = secondCallMessages[secondCallMessages.length - 1];
  assert.deepEqual(lastMessage.content, [
    { type: "tool_result", toolUseId: "1", toolResult: "user denied this tool call", isError: true },
  ]);
});

test("passes the configured systemPrompt through to the provider on every call", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "hi" }], stopReason: "end_turn" }]);
  const agent = new Agent({ provider, tools: registryWith(), systemPrompt: "You are a pirate." });

  await agent.send("hello");

  assert.equal(provider.calls[0].systemPrompt, "You are a pirate.");
});

test("defaults to an empty systemPrompt when none is given", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "hi" }], stopReason: "end_turn" }]);
  const agent = new Agent({ provider, tools: registryWith() });

  await agent.send("hello");

  assert.equal(provider.calls[0].systemPrompt, "");
});

test("streams text via onTextDelta and still fires onAssistantText once with the full text at the end", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "hello there" }], stopReason: "end_turn", textDeltas: ["hel", "lo ", "there"] },
  ]);
  const deltas: string[] = [];
  const finals: string[] = [];
  const agent = new Agent({
    provider,
    tools: registryWith(),
    onTextDelta: (chunk) => deltas.push(chunk),
    onAssistantText: (text) => finals.push(text),
  });

  const result = await agent.send("hi");

  assert.equal(result, "hello there");
  assert.deepEqual(deltas, ["hel", "lo ", "there"]);
  assert.deepEqual(finals, ["hello there"]);
});

function toolReturning(result: ToolResult): Tool<{ text: string }> {
  return {
    name: "flaggy",
    description: "A tool whose result is scripted for the test.",
    schema: z.object({ text: z.string() }),
    execute: () => result,
  };
}

test("onRiskFlag fires for risk 'high', and the text fed back to the provider is annotated with it", async () => {
  const provider = new MockProvider([
    {
      content: [
        { type: "tool_use", toolUseId: "1", toolName: "flaggy", toolInput: JSON.stringify({ text: "x" }) },
      ],
      stopReason: "tool_use",
    },
    { content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
  ]);
  const flags: { name: string; risk: string; next?: string }[] = [];
  const agent = new Agent({
    provider,
    tools: registryWith(
      toolReturning({ result: "found a secret", isError: false, risk: "high", nextRecommended: "rotate it" }),
    ),
    onRiskFlag: (name, risk, nextRecommended) => flags.push({ name, risk, next: nextRecommended }),
  });

  await agent.send("audit for secrets");

  assert.deepEqual(flags, [{ name: "flaggy", risk: "high", next: "rotate it" }]);
  const secondCallMessages = provider.calls[1].messages;
  const lastMessage = secondCallMessages[secondCallMessages.length - 1];
  const toolResultBlock = lastMessage.content[0] as { toolResult: string };
  assert.match(toolResultBlock.toolResult, /^\[risk: high\] next recommended: rotate it\nfound a secret$/);
});

test("onRiskFlag never fires for risk 'none' or an unset risk, and the text is passed through unannotated", async () => {
  const provider = new MockProvider([
    {
      content: [
        { type: "tool_use", toolUseId: "1", toolName: "flaggy", toolInput: JSON.stringify({ text: "x" }) },
      ],
      stopReason: "tool_use",
    },
    { content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
  ]);
  const flags: unknown[] = [];
  const agent = new Agent({
    provider,
    tools: registryWith(toolReturning({ result: "all clear", isError: false, risk: "none" })),
    onRiskFlag: (...args) => flags.push(args),
  });

  await agent.send("check things");

  assert.deepEqual(flags, []);
  const secondCallMessages = provider.calls[1].messages;
  const lastMessage = secondCallMessages[secondCallMessages.length - 1];
  assert.deepEqual(lastMessage.content, [
    { type: "tool_result", toolUseId: "1", toolResult: "all clear", isError: false },
  ]);
});

test("records a correlated tool request/response pair when debug logging is enabled", async () => {
  setDebugEnabled(true);
  const provider = new MockProvider([
    { content: [{ type: "tool_use", toolUseId: "1", toolName: "echo", toolInput: JSON.stringify({ text: "ping" }) }], stopReason: "tool_use" },
    { content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({ provider, tools: registryWith(echoTool) });

  await agent.send("echo ping");

  const events = debugSnapshot().filter((e) => e.source === "tool");
  assert.equal(events.length, 2);
  const [req, resp] = events;
  assert.equal(req.level, "info");
  assert.match(req.message, /→ echo/);
  assert.equal(req.payload, JSON.stringify({ text: "ping" }));
  assert.equal(resp.correlatedId, req.id);
  assert.equal(resp.level, "info");
  assert.equal(resp.payload, "ping");
});

test("records nothing when debug logging is off (the default)", async () => {
  const provider = new MockProvider([
    { content: [{ type: "tool_use", toolUseId: "1", toolName: "echo", toolInput: JSON.stringify({ text: "ping" }) }], stopReason: "tool_use" },
    { content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({ provider, tools: registryWith(echoTool) });

  await agent.send("echo ping");

  assert.deepEqual(debugSnapshot(), []);
});

test("records a denial as a warn event correlated back to the request", async () => {
  setDebugEnabled(true);
  const provider = new MockProvider([
    { content: [{ type: "tool_use", toolUseId: "1", toolName: "risky", toolInput: JSON.stringify({ text: "boom" }) }], stopReason: "tool_use" },
    { content: [{ type: "text", text: "ok, skipped it" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({ provider, tools: registryWith(riskyTool), confirm: async () => false });

  await agent.send("do the risky thing");

  const events = debugSnapshot().filter((e) => e.source === "tool");
  assert.equal(events.length, 2);
  const [req, denial] = events;
  assert.equal(denial.level, "warn");
  assert.match(denial.message, /denied: risky/);
  assert.equal(denial.correlatedId, req.id);
});

test("records a compaction event only when compaction actually changes the message count", async () => {
  setDebugEnabled(true);
  const provider = new MockProvider([{ content: [{ type: "text", text: "hi" }], stopReason: "end_turn" }]);
  const agent = new Agent({
    provider,
    tools: registryWith(),
    compactor: { compact: async () => [] }, // drops everything, always "changes"
  });

  await agent.send("hello");

  const compactEvents = debugSnapshot().filter((e) => e.source === "compact");
  assert.equal(compactEvents.length, 1);
  assert.match(compactEvents[0].message, /1 → 0 msgs/);
});

test("throws once maxTurns is exceeded without ever contacting a real provider", async () => {
  const provider = new MockProvider(
    Array.from({ length: 5 }, () => ({
      content: [
        { type: "tool_use" as const, toolUseId: "x", toolName: "echo", toolInput: JSON.stringify({ text: "x" }) },
      ],
      stopReason: "tool_use" as const,
    })),
  );
  const agent = new Agent({ provider, tools: registryWith(echoTool), maxTurns: 1 });

  await assert.rejects(() => agent.send("loop forever"), /max turns \(1\) reached/);
});

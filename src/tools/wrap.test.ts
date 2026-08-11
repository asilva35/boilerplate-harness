import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clear as clearDebugLog, setEnabled as setDebugEnabled, snapshot as debugSnapshot } from "../debug.js";
import type { Tool, ToolResult } from "./types.js";
import { logExecutionPolicy, truncateOutputPolicy, wrapTool } from "./wrap.js";

beforeEach(() => {
  setDebugEnabled(false);
  clearDebugLog();
});

function echoingTool(response: ToolResult): Tool<{ text: string }> {
  return {
    name: "echo",
    description: "test tool",
    schema: {} as Tool<{ text: string }>["schema"],
    async execute() {
      return response;
    },
  };
}

test("wrapTool preserves the wrapped tool's name/description/schema/requiresConfirmation", () => {
  const inner: Tool = {
    name: "risky",
    description: "does risky things",
    schema: {} as Tool["schema"],
    requiresConfirmation: true,
    execute: () => ({ result: "ok", isError: false }),
  };

  const wrapped = wrapTool(inner, []);

  assert.equal(wrapped.name, "risky");
  assert.equal(wrapped.description, "does risky things");
  assert.equal(wrapped.requiresConfirmation, true);
});

test("wrapTool with no policies behaves exactly like the unwrapped tool", async () => {
  const inner = echoingTool({ result: "hello", isError: false });
  const wrapped = wrapTool(inner, []);

  assert.deepEqual(await wrapped.execute({ text: "hi" }), { result: "hello", isError: false });
});

test("truncateOutputPolicy: leaves output under the limit untouched", async () => {
  const inner = echoingTool({ result: "short", isError: false });
  const wrapped = wrapTool(inner, [truncateOutputPolicy(10_000)]);

  const result = await wrapped.execute({ text: "" });
  assert.equal(result.result, "short");
});

test("truncateOutputPolicy: cuts output over the limit and notes how much was removed", async () => {
  const long = "a".repeat(10_050);
  const inner = echoingTool({ result: long, isError: false });
  const wrapped = wrapTool(inner, [truncateOutputPolicy(10_000)]);

  const result = await wrapped.execute({ text: "" });
  assert.equal(result.result.length < long.length, true);
  assert.match(result.result, /\[truncated 50 more characters\]$/);
  assert.equal(result.result.startsWith("a".repeat(10_000)), true);
});

test("truncateOutputPolicy: applies to error results too, not just successes", async () => {
  const long = "boom ".repeat(3000);
  const inner = echoingTool({ result: long, isError: true });
  const wrapped = wrapTool(inner, [truncateOutputPolicy(10_000)]);

  const result = await wrapped.execute({ text: "" });
  assert.equal(result.isError, true);
  assert.match(result.result, /\[truncated/);
});

test("logExecutionPolicy: records a correlated before/after pair under the 'tool-wrapper' source", async () => {
  setDebugEnabled(true);
  const inner = echoingTool({ result: "output here", isError: false });
  const wrapped = wrapTool(inner, [logExecutionPolicy("bash")]);

  await wrapped.execute({ text: "some input" });

  const events = debugSnapshot().filter((e) => e.source === "tool-wrapper");
  assert.equal(events.length, 2);
  const [before, after] = events;
  assert.match(before.message, /→ bash/);
  assert.equal(before.payload, JSON.stringify({ text: "some input" }));
  assert.equal(after.correlatedId, before.id);
  assert.equal(after.level, "info");
  assert.equal(after.payload, "output here");
});

test("logExecutionPolicy: records an 'error' level after-event when the tool result is an error", async () => {
  setDebugEnabled(true);
  const inner = echoingTool({ result: "boom", isError: true });
  const wrapped = wrapTool(inner, [logExecutionPolicy("bash")]);

  await wrapped.execute({ text: "" });

  const [, after] = debugSnapshot().filter((e) => e.source === "tool-wrapper");
  assert.equal(after.level, "error");
});

test("logExecutionPolicy: logs the RAW (pre-truncation) output when ordered before truncateOutputPolicy", async () => {
  setDebugEnabled(true);
  const long = "x".repeat(10_050);
  const inner = echoingTool({ result: long, isError: false });
  const wrapped = wrapTool(inner, [logExecutionPolicy("bash"), truncateOutputPolicy(10_000)]);

  const result = await wrapped.execute({ text: "" });

  // The model-facing result is truncated...
  assert.equal(result.result.length < long.length, true);
  // ...but the debug log still has the full, untruncated output.
  const [, after] = debugSnapshot().filter((e) => e.source === "tool-wrapper");
  assert.equal(after.payload, long);
});

test("two concurrent calls to the same wrapped tool don't cross-correlate their debug events", async () => {
  setDebugEnabled(true);
  let resolveFirst!: () => void;
  const inner: Tool<{ text: string }> = {
    name: "slow",
    description: "test tool",
    schema: {} as Tool<{ text: string }>["schema"],
    async execute({ text }) {
      if (text === "first") await new Promise<void>((resolve) => (resolveFirst = resolve));
      return { result: `done: ${text}`, isError: false };
    },
  };
  const wrapped = wrapTool(inner, [logExecutionPolicy("slow")]);

  const firstCall = wrapped.execute({ text: "first" });
  const secondCall = await wrapped.execute({ text: "second" });
  resolveFirst();
  const firstResult = await firstCall;

  assert.equal(firstResult.result, "done: first");
  assert.equal(secondCall.result, "done: second");

  // Each call's own before/after pair must correlate to itself, not the
  // other call's - exactly what beforeValue-threading (not a shared
  // mutable reqId) protects against.
  const events = debugSnapshot().filter((e) => e.source === "tool-wrapper");
  const befores = events.filter((e) => e.correlatedId === 0);
  const afters = events.filter((e) => e.correlatedId !== 0);
  assert.equal(befores.length, 2);
  assert.equal(afters.length, 2);

  for (const after of afters) {
    const before = befores.find((b) => b.id === after.correlatedId);
    assert.ok(before, "every after-event must correlate to a real before-event");
    const beforeIsFirst = JSON.parse(before!.payload).text === "first";
    const afterIsFirst = after.payload === "done: first";
    assert.equal(afterIsFirst, beforeIsFirst);
  }
});

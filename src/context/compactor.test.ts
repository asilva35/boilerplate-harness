import { test } from "node:test";
import assert from "node:assert/strict";
import { NoCompaction, SlidingWindow, estimateTokens, safeSplitPoint } from "./compactor.js";
import type { Message } from "../provider/types.js";

function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistantText(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}

test("NoCompaction never touches the history", () => {
  const messages = [userText("a"), assistantText("b")];
  assert.equal(new NoCompaction().compact(messages), messages);
});

test("SlidingWindow leaves history untouched below the message-count limit", () => {
  const messages = [userText("a"), assistantText("b")];
  const result = new SlidingWindow(10).compact(messages);
  assert.deepEqual(result, messages);
});

test("SlidingWindow trims to the last N messages once the limit is exceeded", () => {
  const messages = Array.from({ length: 5 }, (_, i) => userText(`msg ${i}`));
  const result = new SlidingWindow(2).compact(messages);
  assert.deepEqual(result, messages.slice(-2));
});

test("SlidingWindow waits for the token threshold before trimming", () => {
  const messages = Array.from({ length: 5 }, (_, i) => userText(`m${i}`));
  const result = new SlidingWindow(2, 100_000).compact(messages);
  assert.deepEqual(result, messages); // well below the threshold, so no trim yet
});

test("safeSplitPoint walks back to the nearest clean boundary", () => {
  const messages: Message[] = [
    userText("a"),
    assistantText("b"),
    userText("c"),
    { role: "assistant", content: [{ type: "tool_use", toolUseId: "1", toolName: "x", toolInput: "{}" }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "1", toolResult: "ok", isError: false }] },
  ];
  // Index 4 is a tool_result message - cutting there would strand the
  // tool_use at index 3 without its result. The nearest clean boundary is
  // index 2 (a plain user message).
  assert.equal(safeSplitPoint(messages, 4), 2);
});

test("safeSplitPoint returns 0 when no clean boundary exists in range", () => {
  const messages: Message[] = [
    userText("a"),
    { role: "assistant", content: [{ type: "tool_use", toolUseId: "1", toolName: "x", toolInput: "{}" }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "1", toolResult: "ok", isError: false }] },
    assistantText("done"),
  ];
  assert.equal(safeSplitPoint(messages, 2), 0);
});

test("estimateTokens grows with message content length", () => {
  const short = estimateTokens([userText("hi")]);
  const long = estimateTokens([userText("hi".repeat(1000))]);
  assert.ok(long > short);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { NoCompaction, SlidingWindow, Summarize, estimateTokens, renderTranscript, safeSplitPoint } from "./compactor.js";
import { MockProvider } from "../provider/mock.js";
import type { Message } from "../provider/types.js";

function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistantText(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}

test("NoCompaction never touches the history", async () => {
  const messages = [userText("a"), assistantText("b")];
  assert.equal(await new NoCompaction().compact(messages), messages);
});

test("SlidingWindow leaves history untouched below the message-count limit", async () => {
  const messages = [userText("a"), assistantText("b")];
  const result = await new SlidingWindow(10).compact(messages);
  assert.deepEqual(result, messages);
});

test("SlidingWindow trims to the last N messages once the limit is exceeded", async () => {
  const messages = Array.from({ length: 5 }, (_, i) => userText(`msg ${i}`));
  const result = await new SlidingWindow(2).compact(messages);
  assert.deepEqual(result, messages.slice(-2));
});

test("SlidingWindow waits for the token threshold before trimming", async () => {
  const messages = Array.from({ length: 5 }, (_, i) => userText(`m${i}`));
  const result = await new SlidingWindow(2, 100_000).compact(messages);
  assert.deepEqual(result, messages); // well below the threshold, so no trim yet
});

test("Summarize leaves history untouched below the message-count threshold", async () => {
  const provider = new MockProvider([]);
  const messages = [userText("a"), assistantText("b")];
  const result = await new Summarize(provider, 10, 0).compact(messages);
  assert.equal(result, messages);
  assert.equal(provider.calls.length, 0); // never even asked the provider
});

test("Summarize replaces old turns with a synthetic summary message, keeping the recent ones intact", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "user asked about foo.ts, agreed to rename it to bar.ts" }], stopReason: "end_turn" },
  ]);
  const messages = [
    userText("look at foo.ts"),
    assistantText("ok, I see it"),
    userText("rename it to bar.ts"),
    assistantText("done"),
    userText("thanks"),
  ];

  const result = await new Summarize(provider, 3, 1).compact(messages);

  assert.equal(result.length, 2); // 1 synthetic summary + 1 kept recent message
  assert.equal(result[0].role, "user");
  assert.match((result[0].content[0] as { text: string }).text, /^\[earlier conversation summary\]/);
  assert.match((result[0].content[0] as { text: string }).text, /bar\.ts/);
  assert.deepEqual(result[1], messages[4]);

  // The provider was asked to summarize exactly the old portion, not the
  // kept-recent tail.
  const sentPrompt = (provider.calls[0].messages[0].content[0] as { text: string }).text;
  assert.match(sentPrompt, /foo\.ts/);
  assert.doesNotMatch(sentPrompt, /thanks/);
});

test("Summarize gives up and returns the history unchanged if the provider's response has no text", async () => {
  const provider = new MockProvider([{ content: [], stopReason: "end_turn" }]);
  const messages = [userText("a"), assistantText("b"), userText("c")];

  const result = await new Summarize(provider, 1, 0).compact(messages);

  assert.equal(result, messages);
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

test("estimateTokens counts an attached image's base64 payload, not just text/tool blocks", () => {
  const withoutImage = estimateTokens([userText("look at this")]);
  const withImage = estimateTokens([
    { role: "user", content: [{ type: "text", text: "look at this" }, { type: "image", mediaType: "image/png", data: "a".repeat(1000) }] },
  ]);
  assert.ok(withImage > withoutImage + 200); // ~1000 chars / 4 ≈ 250 extra tokens
});

test("renderTranscript shows a placeholder for an image block, not the raw base64 payload", () => {
  const messages: Message[] = [
    { role: "user", content: [{ type: "image", mediaType: "image/png", data: "verylongbase64payload" }] },
  ];
  const transcript = renderTranscript(messages);
  assert.match(transcript, /\[image attached: image\/png\]/);
  assert.doesNotMatch(transcript, /verylongbase64payload/);
});

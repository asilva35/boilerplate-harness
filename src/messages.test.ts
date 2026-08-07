import { test } from "node:test";
import assert from "node:assert/strict";
import { lastMessagePreview, summarizeBlock, truncate } from "./messages.js";

test("summarizeBlock: text collapses whitespace and truncates past 60 chars", () => {
  assert.equal(summarizeBlock({ type: "text", text: "hi  there" }), "hi there");
  const long = "a".repeat(80);
  assert.equal(summarizeBlock({ type: "text", text: long }), "a".repeat(60) + "…");
});

test("summarizeBlock: tool_use and tool_result render as bracketed tags", () => {
  assert.equal(
    summarizeBlock({ type: "tool_use", toolUseId: "1", toolName: "read_file", toolInput: "{}" }),
    "[tool_use read_file]",
  );
  assert.equal(
    summarizeBlock({ type: "tool_result", toolUseId: "1", toolResult: "ok", isError: false }),
    "[tool_result ok]",
  );
  assert.equal(
    summarizeBlock({ type: "tool_result", toolUseId: "1", toolResult: "boom", isError: true }),
    "[tool_result error]",
  );
});

test("truncate: passes short strings through, ellipsizes long ones", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("exactly ten", 10), "exactly te…");
});

test("lastMessagePreview: empty history reports no messages yet", () => {
  assert.equal(lastMessagePreview([]), "(no messages yet)");
});

test("lastMessagePreview: renders the role and a summary of the most recent message only", () => {
  const messages = [
    { role: "user" as const, content: [{ type: "text" as const, text: "first" }] },
    { role: "assistant" as const, content: [{ type: "text" as const, text: "second answer" }] },
  ];
  assert.equal(lastMessagePreview(messages), "[assistant] second answer");
});

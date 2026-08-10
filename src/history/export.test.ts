import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatRecord } from "./types.js";
import { toMarkdown } from "./export.js";

function record(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id: "sess-1",
    title: "Test chat",
    pinned: false,
    userId: "local",
    role: "admin",
    profile: "default",
    updatedAt: "2026-08-08T12:00:00.000Z",
    messageCount: 0,
    lastMessage: "",
    messages: [],
    ...overrides,
  };
}

test("toMarkdown: header carries title, id, and metadata", () => {
  const md = toMarkdown(record());
  assert.match(md, /^# Test chat\n/);
  assert.match(md, /id: sess-1/);
  assert.match(md, /role: admin/);
});

test("toMarkdown: renders a text block under its role heading", () => {
  const md = toMarkdown(
    record({ messages: [{ role: "user", content: [{ type: "text", text: "hello there" }] }] }),
  );
  assert.match(md, /## User\n\nhello there/);
});

test("toMarkdown: fences tool_use and tool_result blocks, marking errors", () => {
  const md = toMarkdown(
    record({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", toolUseId: "t1", toolName: "read_file", toolInput: '{"path":"a.txt"}' },
            { type: "tool_result", toolUseId: "t1", toolResult: "boom", isError: true },
          ],
        },
      ],
    }),
  );
  assert.match(md, /\[tool call\] read_file/);
  assert.match(md, /\{"path":"a\.txt"\}/);
  assert.match(md, /\[tool result - error\]\nboom/);
});

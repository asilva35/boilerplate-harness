import { test } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../provider/mock.js";
import { summarizeSession } from "./summarize-session.js";

const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "let's rename foo to bar" }] }];

test("parses the summary and comma-separated tags from the model's reply", async () => {
  const provider = new MockProvider([
    {
      content: [{ type: "text", text: "Renamed foo to bar across the module.\n\nTAGS: rename, refactor, foo" }],
      stopReason: "end_turn",
    },
  ]);

  const { summary, tags } = await summarizeSession(provider, messages);

  assert.equal(summary, "Renamed foo to bar across the module.");
  assert.deepEqual(tags, ["rename", "refactor", "foo"]);
});

test("falls back to the full text with no tags when the TAGS line is missing", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "just a summary, no tags line" }], stopReason: "end_turn" }]);

  const { summary, tags } = await summarizeSession(provider, messages);

  assert.equal(summary, "just a summary, no tags line");
  assert.deepEqual(tags, []);
});

test("never throws - a provider failure becomes a placeholder summary instead", async () => {
  const provider = new MockProvider([]); // no scripted response - MockProvider throws

  const { summary, tags } = await summarizeSession(provider, messages);

  assert.match(summary, /^\(summarization failed:/);
  assert.deepEqual(tags, []);
});

test("sends the instructions and system prompt is empty (task instructions live in the user turn)", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "summary\n\nTAGS: a" }], stopReason: "end_turn" }]);

  await summarizeSession(provider, messages);

  assert.equal(provider.calls[0].systemPrompt, "");
  const sentText = (provider.calls[0].messages[0].content[0] as { text: string }).text;
  assert.match(sentText, /summarizing a coding-agent session/);
  assert.match(sentText, /rename foo to bar/);
});

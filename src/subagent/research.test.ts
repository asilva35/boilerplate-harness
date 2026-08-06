import { test } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../provider/mock.js";
import { ResearchSubagent } from "./research.js";

test("runs with its own system prompt, not empty and not some caller-supplied one", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "found it" }], stopReason: "end_turn" }]);
  const subagent = new ResearchSubagent(provider);

  await subagent.run("where is the config file?");

  const { systemPrompt } = provider.calls[0];
  assert.notEqual(systemPrompt, "");
  assert.match(systemPrompt, /research subagent/);
});

test("only exposes read_file - never bash or write_file", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "found it" }], stopReason: "end_turn" }]);
  const subagent = new ResearchSubagent(provider);

  await subagent.run("where is the config file?");

  const toolNames = provider.calls[0].tools.map((t) => t.name);
  assert.deepEqual(toolNames, ["read_file"]);
});

test("returns the subagent's final text", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "the config lives at config/app.yaml" }], stopReason: "end_turn" },
  ]);
  const subagent = new ResearchSubagent(provider);

  const result = await subagent.run("where is the config file?");

  assert.equal(result, "the config lives at config/app.yaml");
});

test("each run starts a fresh agent - no history carries over between calls", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "first answer" }], stopReason: "end_turn" },
    { content: [{ type: "text", text: "second answer" }], stopReason: "end_turn" },
  ]);
  const subagent = new ResearchSubagent(provider);

  await subagent.run("first task");
  await subagent.run("second task");

  // Each call's message history should be just its own single user turn,
  // never accumulating the previous run's task/answer.
  assert.equal(provider.calls[1].messages.length, 1);
  assert.equal(provider.calls[1].messages[0].role, "user");
});

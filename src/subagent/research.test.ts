import { test } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../provider/mock.js";
import { readFileTool } from "../tools/read_file.js";
import { bashTool } from "../tools/bash.js";
import { ToolRegistry } from "../tools/registry.js";
import { ResearchSubagent } from "./research.js";

// Phase 23 made the tool pack a caller-supplied ToolRegistry (built by
// tools/catalog.ts's buildToolPack() in production) instead of something
// ResearchSubagent hardcodes itself - this mirrors the pre-Phase-23
// default (read_file only) for tests that aren't specifically exercising
// tool-pack configurability.
function readOnlyTools(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register(readFileTool);
  return tools;
}

test("runs with its own system prompt, not empty and not some caller-supplied one", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "found it" }], stopReason: "end_turn" }]);
  const subagent = new ResearchSubagent(provider, readOnlyTools());

  await subagent.run("where is the config file?");

  const { systemPrompt } = provider.calls[0];
  assert.notEqual(systemPrompt, "");
  assert.match(systemPrompt, /research subagent/);
});

test("with the default tool pack, only exposes read_file - never bash or write_file", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "found it" }], stopReason: "end_turn" }]);
  const subagent = new ResearchSubagent(provider, readOnlyTools());

  await subagent.run("where is the config file?");

  const toolNames = provider.calls[0].tools.map((t) => t.name);
  assert.deepEqual(toolNames, ["read_file"]);
});

test("Phase 23: uses whatever ToolRegistry it's constructed with, not a hardcoded one", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "found it" }], stopReason: "end_turn" }]);
  const customTools = new ToolRegistry();
  customTools.register(readFileTool);
  customTools.register(bashTool); // deliberately unusual for this subagent, to prove it's not hardcoded

  const subagent = new ResearchSubagent(provider, customTools);
  await subagent.run("where is the config file?");

  const toolNames = provider.calls[0].tools.map((t) => t.name).sort();
  assert.deepEqual(toolNames, ["bash", "read_file"]);
});

test("returns the subagent's final text, with no RISK/NEXT lines the result has no risk set", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "the config lives at config/app.yaml" }], stopReason: "end_turn" },
  ]);
  const subagent = new ResearchSubagent(provider, readOnlyTools());

  const result = await subagent.run("where is the config file?");

  assert.equal(result.text, "the config lives at config/app.yaml");
  assert.equal(result.risk, undefined);
  assert.equal(result.nextRecommended, undefined);
});

test("parses a trailing RISK: none / NEXT: none as no risk to report", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "nothing unusual here.\n\nRISK: none\nNEXT: none" }], stopReason: "end_turn" },
  ]);
  const subagent = new ResearchSubagent(provider, readOnlyTools());

  const result = await subagent.run("look around");

  assert.equal(result.text, "nothing unusual here.");
  assert.equal(result.risk, "none");
  assert.equal(result.nextRecommended, undefined);
});

test("parses RISK: high and NEXT: <suggestion>, stripped out of the returned text", async () => {
  const provider = new MockProvider([
    {
      content: [
        {
          type: "text",
          text: "found a hardcoded API key in config/prod.ts.\n\nRISK: high\nNEXT: rotate the key and move it to an env var",
        },
      ],
      stopReason: "end_turn",
    },
  ]);
  const subagent = new ResearchSubagent(provider, readOnlyTools());

  const result = await subagent.run("audit config files for secrets");

  assert.equal(result.text, "found a hardcoded API key in config/prod.ts.");
  assert.equal(result.risk, "high");
  assert.equal(result.nextRecommended, "rotate the key and move it to an env var");
});

test("a reply with no RISK/NEXT lines at all (model didn't follow the format) returns the text as-is, no risk", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "just a plain answer" }], stopReason: "end_turn" }]);
  const subagent = new ResearchSubagent(provider, readOnlyTools());

  const result = await subagent.run("a task");

  assert.equal(result.text, "just a plain answer");
  assert.equal(result.risk, undefined);
});

test("each run starts a fresh agent - no history carries over between calls", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "first answer" }], stopReason: "end_turn" },
    { content: [{ type: "text", text: "second answer" }], stopReason: "end_turn" },
  ]);
  const subagent = new ResearchSubagent(provider, readOnlyTools());

  await subagent.run("first task");
  await subagent.run("second task");

  // Each call's message history should be just its own single user turn,
  // never accumulating the previous run's task/answer.
  assert.equal(provider.calls[1].messages.length, 1);
  assert.equal(provider.calls[1].messages[0].role, "user");
});

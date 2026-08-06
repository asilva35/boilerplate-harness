import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../tools/registry.js";
import { delegateTool } from "./delegate.js";
import type { Subagent } from "./types.js";

function fakeSubagent(overrides: Partial<Subagent> = {}): Subagent {
  return {
    name: "research",
    description: "investigates things",
    run: async (task) => `did: ${task}`,
    ...overrides,
  };
}

test("names the tool delegate_<subagent name> and reuses its description", () => {
  const tool = delegateTool(fakeSubagent());

  assert.equal(tool.name, "delegate_research");
  assert.equal(tool.description, "investigates things");
});

test("execute() runs the subagent with the given task and returns its result", async () => {
  const tool = delegateTool(fakeSubagent());

  const result = await tool.execute({ task: "find the config file" });

  assert.deepEqual(result, { result: "did: find the config file", isError: false });
});

test("a subagent that throws is turned into an error ToolResult by the registry, not a crash", async () => {
  const tool = delegateTool(
    fakeSubagent({
      run: async () => {
        throw new Error("max turns (10) reached");
      },
    }),
  );
  const registry = new ToolRegistry();
  registry.register(tool);

  const result = await registry.execute("delegate_research", JSON.stringify({ task: "loop forever" }));

  assert.deepEqual(result, { result: "max turns (10) reached", isError: true });
});

test("rejects a call with no task through the registry's schema validation", async () => {
  const tool = delegateTool(fakeSubagent());
  const registry = new ToolRegistry();
  registry.register(tool);

  const result = await registry.execute("delegate_research", JSON.stringify({}));

  assert.equal(result.isError, true);
  assert.match(result.result, /invalid tool input/);
});

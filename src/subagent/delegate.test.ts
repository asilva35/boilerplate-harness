import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockProvider } from "../provider/mock.js";
import { SkillRegistry } from "../skills/registry.js";
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

const noSkills = new SkillRegistry([]);

test("names the tool delegate_<subagent name> and reuses its description", () => {
  const tool = delegateTool(fakeSubagent(), new MockProvider([]), noSkills);

  assert.equal(tool.name, "delegate_research");
  assert.equal(tool.description, "investigates things");
});

test("execute() runs the subagent with the given task and returns its result", async () => {
  const tool = delegateTool(fakeSubagent(), new MockProvider([]), noSkills);

  const result = await tool.execute({ task: "find the config file" });

  assert.deepEqual(result, { result: "did: find the config file", isError: false });
});

test("with no matching skills, the subagent receives the task unchanged and no provider call happens", async () => {
  const provider = new MockProvider([]); // would throw if send() were called
  let receivedTask = "";
  const tool = delegateTool(
    fakeSubagent({
      run: async (task) => {
        receivedTask = task;
        return "ok";
      },
    }),
    provider,
    noSkills,
  );

  await tool.execute({ task: "find the config file" });

  assert.equal(receivedTask, "find the config file");
  assert.equal(provider.calls.length, 0);
});

test("with a matching skill, the subagent receives the task augmented with digested rules, not the raw file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "delegate-skills-test-"));
  try {
    const skillPath = path.join(dir, "ts-rules.md");
    await writeFile(skillPath, "---\nname: ts-rules\ntrigger: writing TypeScript code\n---\n\nnever use any\n");
    const skills = new SkillRegistry([{ name: "ts-rules", trigger: "writing TypeScript code", path: skillPath }]);
    const provider = new MockProvider([
      { content: [{ type: "text", text: "- never use any\n- validate with zod" }], stopReason: "end_turn" },
    ]);
    let receivedTask = "";
    const tool = delegateTool(
      fakeSubagent({
        run: async (task) => {
          receivedTask = task;
          return "ok";
        },
      }),
      provider,
      skills,
    );

    await tool.execute({ task: "write a TypeScript function" });

    assert.match(receivedTask, /^write a TypeScript function/);
    assert.match(receivedTask, /Relevant project rules:/);
    assert.match(receivedTask, /never use any/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a subagent that throws is turned into an error ToolResult by the registry, not a crash", async () => {
  const tool = delegateTool(
    fakeSubagent({
      run: async () => {
        throw new Error("max turns (10) reached");
      },
    }),
    new MockProvider([]),
    noSkills,
  );
  const registry = new ToolRegistry();
  registry.register(tool);

  const result = await registry.execute("delegate_research", JSON.stringify({ task: "loop forever" }));

  assert.deepEqual(result, { result: "max turns (10) reached", isError: true });
});

test("rejects a call with no task through the registry's schema validation", async () => {
  const tool = delegateTool(fakeSubagent(), new MockProvider([]), noSkills);
  const registry = new ToolRegistry();
  registry.register(tool);

  const result = await registry.execute("delegate_research", JSON.stringify({}));

  assert.equal(result.isError, true);
  assert.match(result.result, /invalid tool input/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ToolRegistry } from "./registry.js";
import type { Tool, ToolResult } from "./types.js";

const echoTool: Tool<{ text: string }> = {
  name: "echo",
  description: "Echoes back the given text.",
  schema: z.object({ text: z.string() }),
  execute({ text }): ToolResult {
    return { result: text, isError: false };
  },
};

test("returns an error result for malformed JSON input", async () => {
  const registry = new ToolRegistry();
  registry.register(echoTool);

  const result = await registry.execute("echo", "not json");

  assert.equal(result.isError, true);
  assert.match(result.result, /invalid tool input/);
});

test("returns an error result when the input fails schema validation", async () => {
  const registry = new ToolRegistry();
  registry.register(echoTool);

  const result = await registry.execute("echo", JSON.stringify({ text: 123 }));

  assert.equal(result.isError, true);
  assert.match(result.result, /invalid tool input/);
});

test("returns an error result for an unregistered tool", async () => {
  const registry = new ToolRegistry();

  const result = await registry.execute("nonexistent", "{}");

  assert.equal(result.isError, true);
  assert.match(result.result, /unknown tool/);
});

test("sorts tool definitions by name for a deterministic payload", () => {
  const registry = new ToolRegistry();
  registry.register({ ...echoTool, name: "zzz" });
  registry.register({ ...echoTool, name: "aaa" });

  const names = registry.definitions().map((d) => d.name);

  assert.deepEqual(names, ["aaa", "zzz"]);
});

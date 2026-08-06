import { test } from "node:test";
import assert from "node:assert/strict";
import { NoMemory } from "../memory/no-memory.js";
import { MockProvider } from "../provider/mock.js";
import { ConfigError } from "../errors.js";
import { catalogToolNames, registerCatalogTools } from "./catalog.js";
import { ToolRegistry } from "./registry.js";

test("catalogToolNames lists the static tools, every subagent's delegate_<name>, and the memory tools - no provider needed", () => {
  const names = catalogToolNames();

  assert.deepEqual(
    names.sort(),
    ["bash", "delegate_research", "estimate_scope", "read_file", "recall", "remember", "write_file"].sort(),
  );
});

test("registers delegate_research and remember when named in harness.config.json's tools list", () => {
  const registry = new ToolRegistry();
  const provider = new MockProvider([]);
  const memoryStore = new NoMemory();

  registerCatalogTools(registry, ["read_file", "delegate_research", "remember"], provider, memoryStore);

  const names = registry.definitions().map((t) => t.name);
  assert.deepEqual(names, ["delegate_research", "read_file", "remember"]); // definitions() sorts by name
});

test("an unknown tool name throws a ConfigError listing what's actually available", () => {
  const registry = new ToolRegistry();
  const provider = new MockProvider([]);
  const memoryStore = new NoMemory();

  assert.throws(
    () => registerCatalogTools(registry, ["bogus_tool"], provider, memoryStore),
    (err: unknown) => err instanceof ConfigError && /delegate_research/.test((err as Error).message),
  );
});

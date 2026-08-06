import { test } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../provider/mock.js";
import { ConfigError } from "../errors.js";
import { catalogToolNames, registerCatalogTools } from "./catalog.js";
import { ToolRegistry } from "./registry.js";

test("catalogToolNames lists the static tools and every subagent's delegate_<name>, no provider needed", () => {
  const names = catalogToolNames();

  assert.deepEqual(names.sort(), ["bash", "delegate_research", "read_file", "write_file"]);
});

test("registers delegate_research when named in harness.config.json's tools list", () => {
  const registry = new ToolRegistry();
  const provider = new MockProvider([]);

  registerCatalogTools(registry, ["read_file", "delegate_research"], provider);

  const names = registry.definitions().map((t) => t.name);
  assert.deepEqual(names, ["delegate_research", "read_file"]); // definitions() sorts by name
});

test("an unknown tool name throws a ConfigError listing what's actually available", () => {
  const registry = new ToolRegistry();
  const provider = new MockProvider([]);

  assert.throws(
    () => registerCatalogTools(registry, ["bogus_tool"], provider),
    (err: unknown) => err instanceof ConfigError && /delegate_research/.test((err as Error).message),
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { NoMemory } from "../memory/no-memory.js";
import type { MCPClient, MCPToolDef } from "../mcp/client.js";
import type { ConnectedMCPServer } from "../mcp/register.js";
import { MockProvider } from "../provider/mock.js";
import { SkillRegistry } from "../skills/registry.js";
import { ConfigError } from "../errors.js";
import { buildToolPack, catalogToolNames, registerCatalogTools } from "./catalog.js";
import { ToolRegistry } from "./registry.js";

// MCPClient has a private constructor/field, so a plain object can't
// structurally satisfy it - these tests never call callTool()/close(), so
// a minimal cast stands in for a real connected client.
function fakeMCPServer(name: string, defs: MCPToolDef[]): ConnectedMCPServer {
  const client = { callTool: async () => ({ result: "", isError: false }), close: async () => {} } as unknown as MCPClient;
  return { name, client, defs };
}

function fakeToolDef(name: string): MCPToolDef {
  return { name, description: `fake ${name}`, inputSchema: {}, required: [] };
}

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
  const skillRegistry = new SkillRegistry([]);

  registerCatalogTools(registry, ["read_file", "delegate_research", "remember"], provider, memoryStore, skillRegistry);

  const names = registry.definitions().map((t) => t.name);
  assert.deepEqual(names, ["delegate_research", "read_file", "remember"]); // definitions() sorts by name
});

test("an unknown tool name throws a ConfigError listing what's actually available", () => {
  const registry = new ToolRegistry();
  const provider = new MockProvider([]);
  const memoryStore = new NoMemory();
  const skillRegistry = new SkillRegistry([]);

  assert.throws(
    () => registerCatalogTools(registry, ["bogus_tool"], provider, memoryStore, skillRegistry),
    (err: unknown) => err instanceof ConfigError && /delegate_research/.test((err as Error).message),
  );
});

test("buildToolPack: resolves local (STATIC_CATALOG) tool names with no MCP servers involved", () => {
  const pack = buildToolPack(["read_file", "bash"], []);
  assert.deepEqual(pack.definitions().map((t) => t.name).sort(), ["bash", "read_file"]);
});

test("buildToolPack: resolves an MCP-sourced tool by its server_tool name, alongside a local one", () => {
  const filesystem = fakeMCPServer("filesystem", [fakeToolDef("read_text_file")]);
  const pack = buildToolPack(["read_file", "filesystem_read_text_file"], [filesystem]);

  assert.deepEqual(pack.definitions().map((t) => t.name).sort(), ["filesystem_read_text_file", "read_file"]);
});

test("buildToolPack: a name that's neither local nor exposed by a connected MCP server throws ConfigError", () => {
  assert.throws(
    () => buildToolPack(["read_file", "bogus_tool"], []),
    (err: unknown) => err instanceof ConfigError && /bogus_tool/.test((err as Error).message),
  );
});

test("buildToolPack: never resolves bash unless explicitly named, even with MCP servers connected", () => {
  const filesystem = fakeMCPServer("filesystem", [fakeToolDef("read_text_file")]);
  const pack = buildToolPack(["read_file", "filesystem_read_text_file"], [filesystem]);
  assert.equal(pack.get("bash"), undefined);
});

test("registerCatalogTools: delegate_research's subagent gets the configured tool pack, not the hardcoded default", async () => {
  const registry = new ToolRegistry();
  const provider = new MockProvider([{ content: [{ type: "text", text: "ok" }], stopReason: "end_turn" }]);
  const memoryStore = new NoMemory();
  const skillRegistry = new SkillRegistry([]);
  const filesystem = fakeMCPServer("filesystem", [fakeToolDef("read_text_file")]);

  registerCatalogTools(
    registry,
    ["delegate_research"],
    provider,
    memoryStore,
    skillRegistry,
    { research: ["filesystem_read_text_file"] }, // deliberately NOT read_file, to prove it's not the default
    [filesystem],
  );

  await registry.execute("delegate_research", JSON.stringify({ task: "look something up" }));

  const subagentToolNames = provider.calls[0].tools.map((t) => t.name);
  assert.deepEqual(subagentToolNames, ["filesystem_read_text_file"]);
});

test("registerCatalogTools: with no subagent config, research falls back to the pre-Phase-23 default (read_file only)", async () => {
  const registry = new ToolRegistry();
  const provider = new MockProvider([{ content: [{ type: "text", text: "ok" }], stopReason: "end_turn" }]);
  const memoryStore = new NoMemory();
  const skillRegistry = new SkillRegistry([]);

  registerCatalogTools(registry, ["delegate_research"], provider, memoryStore, skillRegistry);

  await registry.execute("delegate_research", JSON.stringify({ task: "look something up" }));

  const subagentToolNames = provider.calls[0].tools.map((t) => t.name);
  assert.deepEqual(subagentToolNames, ["read_file"]);
});

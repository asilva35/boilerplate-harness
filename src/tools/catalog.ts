// Phase 8: the set of local tools this core ships with, keyed by the name
// harness.config.json's "tools" array references. Entry points no longer
// hardcode which of these to register — registerCatalogTools() reads that
// list from config instead, so enabling/disabling a local tool for a given
// deployment is a one-line change in harness.config.json, not a code edit
// in three entry points.
//
// Phase 14: subagents (registerSubagents() below) need a Provider to
// construct, unlike the static tools above — so STATIC_CATALOG stays a
// plain map, and delegate_<name> tools are built on demand inside
// registerCatalogTools() instead.

import { ConfigError } from "../errors.js";
import type { MemoryStore } from "../memory/types.js";
import { type ConnectedMCPServer, registerMCPTools } from "../mcp/register.js";
import type { Provider } from "../provider/types.js";
import type { SkillRegistry } from "../skills/registry.js";
import { delegateTool } from "../subagent/delegate.js";
import { ResearchSubagent } from "../subagent/research.js";
import { SubagentRegistry } from "../subagent/registry.js";
import { bashTool } from "./bash.js";
import { estimateScopeTool } from "./estimate_scope.js";
import { readFileTool } from "./read_file.js";
import { recallTool } from "./recall.js";
import { rememberTool } from "./remember.js";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";
import { writeFileTool } from "./write_file.js";

const STATIC_CATALOG: Record<string, Tool> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  bash: bashTool,
  estimate_scope: estimateScopeTool,
};

// Phase 16: remember/recall need a MemoryStore to construct, same reason
// subagents need a Provider - built on demand inside registerCatalogTools()
// below instead of living in STATIC_CATALOG.
const MEMORY_TOOL_NAMES = ["remember", "recall"];

function buildMemoryTools(store: MemoryStore): Map<string, Tool> {
  return new Map<string, Tool>([
    ["remember", rememberTool(store)],
    ["recall", recallTool(store)],
  ]);
}

// Every subagent this boilerplate ships with. Keep in sync with
// registerSubagents() below - kept as a separate plain list (rather than
// constructing real Subagent instances) so catalogToolNames() can list
// names for scaffold.ts's prompts without needing a Provider yet.
const SUBAGENT_NAMES = ["research"];

// Phase 23: what each subagent gets when harness.config.json's "subagents"
// doesn't override it - preserves the exact pre-Phase-23 behavior
// (research: read_file only) for any deployment that doesn't opt in to
// configuring subagent tool packs.
const DEFAULT_SUBAGENT_TOOLS: Record<string, string[]> = {
  research: ["read_file"],
};

// Phase 23: resolves a list of tool names into a fresh ToolRegistry,
// sourced from either the local STATIC_CATALOG or an already-connected MCP
// server - the pool a subagent's tool pack can draw from. Deliberately
// excludes delegate_*/remember/recall (a subagent delegating to itself or
// managing memory isn't a case this boilerplate supports) and doesn't
// require a Provider/MemoryStore, unlike registerCatalogTools() below.
export function buildToolPack(names: string[], connectedMCP: ConnectedMCPServer[]): ToolRegistry {
  const mcpPool = new ToolRegistry();
  registerMCPTools(mcpPool, connectedMCP);

  const registry = new ToolRegistry();
  for (const name of names) {
    const tool = STATIC_CATALOG[name] ?? mcpPool.get(name);
    if (!tool) {
      const available = [...Object.keys(STATIC_CATALOG), ...connectedMCP.flatMap((s) => s.defs.map((d) => `${s.name}_${d.name}`))];
      throw new ConfigError(
        `Unknown tool "${name}" in a subagent's tool pack (harness.config.json "subagents") - not a ` +
          `local tool and no connected MCP server exposes it. Available: ${available.join(", ")}.`,
      );
    }
    registry.register(tool);
  }
  return registry;
}

// Every subagent this boilerplate ships with, exposed as delegate_<name> in
// the tool catalog below. Extend this one function (and SUBAGENT_NAMES
// above) to add another one - analogous to registerSubagents() in Go's
// main.go.
function registerSubagents(
  registry: SubagentRegistry,
  provider: Provider,
  subagentTools: Record<string, string[]>,
  connectedMCP: ConnectedMCPServer[],
): void {
  const researchTools = buildToolPack(subagentTools.research ?? DEFAULT_SUBAGENT_TOOLS.research, connectedMCP);
  registry.register(new ResearchSubagent(provider, researchTools));
}

// Tool names harness.config.json's "tools" array can reference, without
// needing a Provider - scaffold.ts uses this to prompt "enable tool X?"
// before any provider/API key exists yet.
export function catalogToolNames(): string[] {
  return [...Object.keys(STATIC_CATALOG), ...SUBAGENT_NAMES.map((n) => `delegate_${n}`), ...MEMORY_TOOL_NAMES];
}

export function registerCatalogTools(
  registry: ToolRegistry,
  names: string[],
  provider: Provider,
  memoryStore: MemoryStore,
  skillRegistry: SkillRegistry,
  // Phase 23: optional (default {}/[]) so existing call sites that don't
  // care about subagent tool packs - most unit tests - don't need to
  // change. Real entry points pass harnessConfig.subagents and whatever
  // MCP servers are already connected.
  subagentTools: Record<string, string[]> = {},
  connectedMCP: ConnectedMCPServer[] = [],
): void {
  const subagents = new SubagentRegistry();
  registerSubagents(subagents, provider, subagentTools, connectedMCP);
  const delegateTools = new Map<string, Tool>(
    subagents.all().map((s) => [`delegate_${s.name}`, delegateTool(s, provider, skillRegistry)]),
  );
  const memoryTools = buildMemoryTools(memoryStore);

  for (const name of names) {
    const tool = STATIC_CATALOG[name] ?? delegateTools.get(name) ?? memoryTools.get(name);
    if (!tool) {
      const available = [...Object.keys(STATIC_CATALOG), ...delegateTools.keys(), ...memoryTools.keys()];
      throw new ConfigError(`Unknown tool "${name}" in harness.config.json (available: ${available.join(", ")}).`);
    }
    registry.register(tool);
  }
}

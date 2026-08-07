// Phase 8: the per-deployment half of configuration. No Go equivalent —
// inspired by how "Gentle" (see docs referenced in the migration guide)
// installs as a config layer over an existing agent runtime, not by
// anything in the original Go project.
//
// This is deliberately a *second*, separate module from config.ts: env
// vars (config.ts) are secrets and never committed; harness.config.json
// (this file) is deployment behavior — system prompt, how compaction is
// tuned — and IS meant to be committed, the same way vite.config.ts is
// committed while .env isn't. Forking this project to build a new harness
// should mean editing committed config files, not forking code.
//
// Phase 24: split further, on purpose. What tools/roles/subagents a
// deployment loads now lives in a companion tools.json (analogous to
// mcp.json) instead of inline here - so registering a tool is config, the
// same spirit Phase 8 already had for the rest of deployment behavior,
// just carried one step further for the piece that changes most often
// when adapting this boilerplate to a new vertical.

import { readFileSync } from "node:fs";
import { z } from "zod";
import { ConfigError } from "./errors.js";

const compactionSchema = z
  .object({
    strategy: z.enum(["sliding", "none", "summarize"]).default("sliding"),
    keepLast: z.number().int().positive().default(20),
    tokenThreshold: z.number().int().nonnegative().default(4000),
    // Only used by "summarize" (Phase 13): a message-count trigger, unlike
    // tokenThreshold above - matching Go's Summarize.Threshold, which the
    // migration guide's entregable also states in message-count terms.
    summarizeThreshold: z.number().int().positive().default(40),
  })
  .default({ strategy: "sliding", keepLast: 20, tokenThreshold: 4000, summarizeThreshold: 40 });

// harness.<profile>.config.json: how the harness behaves.
const harnessConfigSchema = z.object({
  systemPrompt: z.string().min(1),
  compaction: compactionSchema,
});

// tools.<profile>.json: what the harness can reach. Phase 21: `roles`,
// each carving out a subset of `tools` for a non-admin caller (e.g. a
// "client" role with no bash/write_file). Opt-in - an empty map (the
// default) means every session gets the full `tools` list. Phase 23:
// `subagents`, per-subagent tool packs (e.g. give `research` a
// filesystem_* MCP tool but never `bash`), overriding
// tools/catalog.ts's hardcoded DEFAULT_SUBAGENT_TOOLS. Not validated here
// the way `roles` is against `tools` below - a subagent's tool pack can
// legitimately name an MCP tool, and MCP servers aren't connected yet at
// config-load time (that happens later, async, in each entry point's
// main()). Resolved and validated at the point a subagent is actually
// built - see tools/catalog.ts's buildToolPack().
// Phase 26: `subagentModels`, an optional model override per subagent name
// (e.g. run `research` on a cheaper/faster model than the root agent) -
// kept alongside `subagents` rather than in harness.<profile>.config.json
// (which the migration guide's own text points to) for the same cohesion
// reason Phase 24 split this file out in the first place: everything about
// a given subagent's configuration - which tools it gets, which model it
// runs on - lives in one place instead of two. A subagent with no entry
// here just inherits whatever model the session's Provider is already
// using, same as before this phase existed.
const toolsConfigSchema = z.object({
  tools: z.array(z.string()),
  roles: z.record(z.string(), z.array(z.string())).default({}),
  subagents: z.record(z.string(), z.array(z.string())).default({}),
  subagentModels: z.record(z.string(), z.string()).default({}),
});

// The merged shape every consumer (resolveRoleTools, SessionManager,
// tools/catalog.ts, ...) actually works with - unchanged since before
// Phase 24, so loading from two files instead of one doesn't ripple past
// this module. Only how a HarnessConfig gets assembled changes below.
export type HarnessConfig = z.infer<typeof harnessConfigSchema> & z.infer<typeof toolsConfigSchema>;

// "admin" is reserved: it always means the full `tools` list and must
// never be declared in `roles` - a config author trying to give "admin" a
// restricted roster there almost certainly means something else, so this
// fails loud instead of silently doing nothing.
export function validateRoles(config: HarnessConfig): void {
  if ("admin" in config.roles) {
    throw new ConfigError(
      '"admin" is a reserved role name (it always means the full "tools" list) - remove it from ' +
        '"roles" in tools.json.',
    );
  }
  for (const [role, tools] of Object.entries(config.roles)) {
    for (const tool of tools) {
      if (!config.tools.includes(tool)) {
        throw new ConfigError(
          `tools.json: role "${role}" lists tool "${tool}", which isn't in the top-level "tools" ` +
            "array - a role can only narrow the full tool set, not add to it.",
        );
      }
    }
  }
}

// Resolves the tool names a session with the given role should get.
// "admin" (also the default when no role is given at all - see
// server.ts) always resolves to the full `tools` list, whether or not
// `roles` is configured. Any other role name must be a key in `roles` -
// an unrecognized role is a caller error and must fail closed, not
// silently fall back to the full admin roster.
export function resolveRoleTools(config: HarnessConfig, role: string): string[] {
  if (role === "admin") return config.tools;
  const tools = config.roles[role];
  if (!tools) {
    throw new ConfigError(
      `Unknown role "${role}" (no matching entry in tools.json's "roles"). ` +
        `Available roles: admin, ${Object.keys(config.roles).join(", ") || "(none configured)"}.`,
    );
  }
  return tools;
}

function readConfigFile(path: string, whatItHolds: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        `Missing ${path} in the current directory. This file holds ${whatItHolds} and is expected ` +
          `to exist — see ${path} in the repo root for the reference shape, or run this project's ` +
          "own copy of it if you're inside a scaffolded project.",
      );
    }
    throw err;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

// Parses harness.<profile>.config.json in isolation - system prompt and
// compaction only, nothing tool-related.
export function loadHarnessSection(path: string): z.infer<typeof harnessConfigSchema> {
  const result = harnessConfigSchema.safeParse(readConfigFile(path, "per-deployment behavior (system prompt, compaction)"));
  if (!result.success) {
    throw new ConfigError(`${path} is invalid: ${result.error.message}`);
  }
  return result.data;
}

// Parses tools.<profile>.json in isolation - tools/roles/subagents only.
// Deliberately doesn't run validateRoles() itself: that needs the merged
// HarnessConfig (roles are checked against `tools`, which lives in this
// same file, so in practice it could - but loadProfileConfig() is the one
// place that owns "assemble, then validate the merged result", to keep a
// single validation call site as more sections potentially get added).
export function loadToolsSection(path: string): z.infer<typeof toolsConfigSchema> {
  const result = toolsConfigSchema.safeParse(readConfigFile(path, 'what the harness can reach (tools/roles/subagents) - analogous to mcp.json'));
  if (!result.success) {
    throw new ConfigError(`${path} is invalid: ${result.error.message}`);
  }
  return result.data;
}

// Assembles one profile's effective HarnessConfig from its two files.
// "default" (Phase 22's convention) uses the bare harness.config.json /
// tools.json; any other profile name `p` inserts itself the same way
// Phase 22 already did for the harness section: harness.p.config.json /
// tools.p.json.
export function loadProfileConfig(profileName: string): HarnessConfig {
  const suffix = profileName === "default" ? "" : `${profileName}.`;
  const harness = loadHarnessSection(`harness.${suffix}config.json`);
  const tools = loadToolsSection(`tools.${suffix}json`);
  const merged: HarnessConfig = { ...harness, ...tools };
  validateRoles(merged);
  return merged;
}

// Computed once at import time, same pattern config.ts already uses for
// env vars — every entry point imports the same resolved singleton instead
// of re-reading and re-parsing the files per call site. Also doubles as the
// "default" profile's config for ProfileRegistry below, so the files are
// never read/parsed twice.
export const harnessConfig = loadProfileConfig("default");

// Phase 22: a session can now resolve its own effective config instead of
// every session in the process sharing the one global `harnessConfig`
// above - different system prompt, different tool-pack. Configs are
// loaded lazily (only profiles a session actually asks for get read off
// disk) and cached - re-parsing and re-validating four files on every
// session creation would be pure waste, they don't change while the
// process runs.
export class ProfileRegistry {
  private readonly cache = new Map<string, HarnessConfig>([["default", harnessConfig]]);

  get(name: string): HarnessConfig {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const config = loadProfileConfig(name);
    this.cache.set(name, config);
    return config;
  }
}

// Phase 8: the per-deployment half of configuration. No Go equivalent —
// inspired by how "Gentle" (see docs referenced in the migration guide)
// installs as a config layer over an existing agent runtime, not by
// anything in the original Go project.
//
// This is deliberately a *second*, separate module from config.ts: env
// vars (config.ts) are secrets and never committed; harness.config.json
// (this file) is deployment behavior — system prompt, which tools load,
// how compaction is tuned — and IS meant to be committed, the same way
// vite.config.ts is committed while .env isn't. Forking this project to
// build a new harness should mean editing this one file, not forking code.

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

// Phase 21: named roles, each carving out a subset of `tools` for a
// non-admin caller (e.g. a "client" role with no bash/write_file). Opt-in -
// an empty map (the default) means every session gets the full `tools`
// list, identical to pre-Phase-21 behavior.
const harnessConfigSchema = z.object({
  systemPrompt: z.string().min(1),
  tools: z.array(z.string()),
  compaction: compactionSchema,
  roles: z.record(z.string(), z.array(z.string())).default({}),
});

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

// "admin" is reserved: it always means the full `tools` list and must
// never be declared in `roles` - a config author trying to give "admin" a
// restricted roster there almost certainly means something else, so this
// fails loud instead of silently doing nothing.
export function validateRoles(config: HarnessConfig): void {
  if ("admin" in config.roles) {
    throw new ConfigError(
      '"admin" is a reserved role name (it always means the full "tools" list) - remove it from ' +
        '"roles" in harness.config.json.',
    );
  }
  for (const [role, tools] of Object.entries(config.roles)) {
    for (const tool of tools) {
      if (!config.tools.includes(tool)) {
        throw new ConfigError(
          `harness.config.json: role "${role}" lists tool "${tool}", which isn't in the top-level ` +
            '"tools" array - a role can only narrow the full tool set, not add to it.',
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
      `Unknown role "${role}" (no matching entry in harness.config.json's "roles"). ` +
        `Available roles: admin, ${Object.keys(config.roles).join(", ") || "(none configured)"}.`,
    );
  }
  return tools;
}

// Phase 22: generalized from the original load() (which only ever read
// "harness.config.json") to take any path, so a ProfileRegistry can load
// "harness.<profile>.config.json" files the same way without duplicating
// this parse/validate logic.
export function loadHarnessConfig(path: string): HarnessConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        `Missing ${path} in the current directory. This file holds per-deployment settings ` +
          "(system prompt, tools, compaction) and is expected to exist — see harness.config.json " +
          "in the repo root for the reference shape, or run this project's own copy of it if " +
          "you're inside a scaffolded project.",
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${(err as Error).message}`);
  }

  const result = harnessConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`${path} is invalid: ${result.error.message}`);
  }
  validateRoles(result.data);
  return result.data;
}

// Computed once at import time, same pattern config.ts already uses for
// env vars — every entry point imports the same resolved singleton instead
// of re-reading and re-parsing the file per call site. Also doubles as the
// "default" profile's config for server.ts's ProfileRegistry below, so the
// file is never read/parsed twice.
export const harnessConfig = loadHarnessConfig("harness.config.json");

// Phase 22: a session can now resolve its own effective harness.config.json
// instead of every session in the process sharing the one global
// `harnessConfig` above - different system prompt, different tool-pack.
// "default" always maps to harness.config.json (the file already loaded
// into `harnessConfig`, reused instead of re-read); any other profile name
// `p` maps to harness.<p>.config.json in the same directory. Configs are
// loaded lazily (only profiles a session actually asks for get read off
// disk) and cached - re-parsing and re-validating on every session creation
// would be pure waste, the file doesn't change while the process runs.
export class ProfileRegistry {
  private readonly cache = new Map<string, HarnessConfig>([["default", harnessConfig]]);

  get(name: string): HarnessConfig {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const config = loadHarnessConfig(`harness.${name}.config.json`);
    this.cache.set(name, config);
    return config;
  }
}

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

const harnessConfigSchema = z.object({
  systemPrompt: z.string().min(1),
  tools: z.array(z.string()),
  compaction: compactionSchema,
});

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

function load(): HarnessConfig {
  let raw: string;
  try {
    raw = readFileSync("harness.config.json", "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        'Missing harness.config.json in the current directory. This file holds per-deployment ' +
          'settings (system prompt, tools, compaction) and is expected to exist — see ' +
          "harness.config.json in the repo root for the reference shape, or run this project's " +
          "own copy of it if you're inside a scaffolded project.",
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`harness.config.json is not valid JSON: ${(err as Error).message}`);
  }

  const result = harnessConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`harness.config.json is invalid: ${result.error.message}`);
  }
  return result.data;
}

// Computed once at import time, same pattern config.ts already uses for
// env vars — every entry point imports the same resolved singleton instead
// of re-reading and re-parsing the file per call site.
export const harnessConfig = load();

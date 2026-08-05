// Phase 8: the set of local tools this core ships with, keyed by the name
// harness.config.json's "tools" array references. Entry points no longer
// hardcode which of these to register — registerCatalogTools() reads that
// list from config instead, so enabling/disabling a local tool for a given
// deployment is a one-line change in harness.config.json, not a code edit
// in three entry points.

import { ConfigError } from "../errors.js";
import { bashTool } from "./bash.js";
import { readFileTool } from "./read_file.js";
import type { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";
import { writeFileTool } from "./write_file.js";

export const TOOL_CATALOG: Record<string, Tool> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  bash: bashTool,
};

export function registerCatalogTools(registry: ToolRegistry, names: string[]): void {
  for (const name of names) {
    const tool = TOOL_CATALOG[name];
    if (!tool) {
      throw new ConfigError(
        `Unknown tool "${name}" in harness.config.json (available: ${Object.keys(TOOL_CATALOG).join(", ")}).`,
      );
    }
    registry.register(tool);
  }
}

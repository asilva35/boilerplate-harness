// Equivalent to internal/subagent/registry.go's Registry: a simple map of
// subagents by name, analogous to ToolRegistry - minus tool-calling
// concerns (definitions, schema validation), since a Subagent is invoked
// directly, not through the provider's tool-use protocol.

import type { Subagent } from "./types.js";

export class SubagentRegistry {
  private readonly subagents = new Map<string, Subagent>();

  register(subagent: Subagent): void {
    this.subagents.set(subagent.name, subagent);
  }

  all(): Subagent[] {
    return [...this.subagents.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

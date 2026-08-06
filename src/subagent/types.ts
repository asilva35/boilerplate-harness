// Equivalent to the Subagent interface in internal/subagent/registry.go: a
// focused agent the root can delegate to, exposed to it as a callable tool
// (see ./delegate.ts). Same shape as a tool - takes a task, returns a
// result - but backed by its own Agent instance and context window
// underneath.

import type { Risk } from "../tools/types.js";

// Phase 18: run() returns this instead of a plain string, so a subagent
// can report risk/nextRecommended the same way a Tool's ToolResult does -
// delegateTool maps it 1:1 into the ToolResult it returns.
export interface SubagentResult {
  text: string;
  risk?: Risk;
  nextRecommended?: string;
}

export interface Subagent {
  readonly name: string;
  readonly description: string;
  run(task: string): Promise<SubagentResult>;
}

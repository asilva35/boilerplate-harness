// Equivalent to Go's Tool interface (internal/tool/registry.go):
//
//   type Tool interface {
//       Definition() api.ToolDef
//       Execute(ctx context.Context, input string) (result string, isError bool)
//   }
//
// In Go, Definition() builds the JSON Schema by hand. Here we use a Zod
// schema as the source of truth: it serves to (a) validate the raw input
// the model sends before executing anything, and (b) derive the JSON
// Schema sent to the provider (see registry.ts → zodToJsonSchema).
//
// "Errors as results, not exceptions": if something fails, a tool returns
// { isError: true } so the model can read it and retry, instead of taking
// down the loop — same criterion AGENTS.md documents for the Go project
// ("Errors as tool results, not Go errors").
//
// requiresConfirmation (Phase 3): the original Go project asks for [y/N]
// approval on EVERY tool call, without distinction. Here we classify by
// risk instead, as the migration guide suggests: read_file is read-only
// and runs directly; bash and write_file can alter the system, so the
// agent loop intercepts them before executing.
//
// toolDef (Phase 5): for local tools, the JSON Schema the model sees is
// derived from the Zod `schema` (see registry.ts). For MCP tools, the real
// JSON Schema already comes assembled from the remote server — same as in
// Go, where MCPTool.Definition() returns the stored Def as-is, without
// going through any Go-side parser. When `toolDef` is present, the
// registry uses it directly and skips the Zod-based derivation.

import type { ZodType } from "zod";
import type { ToolDef } from "../provider/types.js";

// Phase 18: an optional structured "envelope" on top of the plain result
// text. No tool is required to fill these in - most tools have nothing
// risky to report - but subagents (Phase 14) and delegateTool should,
// since a subagent's exploration is exactly the kind of thing that can
// turn up something a human should see immediately instead of it staying
// buried in prose.
export type Risk = "none" | "low" | "high";

export interface ToolResult {
  result: string;
  isError: boolean;
  risk?: Risk;
  nextRecommended?: string;
}

export interface Tool<TInput = any> {
  name: string;
  description: string;
  schema: ZodType<TInput>;
  toolDef?: ToolDef;
  requiresConfirmation?: boolean;
  execute(input: TInput): Promise<ToolResult> | ToolResult;
}

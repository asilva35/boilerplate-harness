// Phase 32: generalizes the Phase 3 confirm/requiresConfirmation gate (a
// single before-hook baked directly into agent.ts) into a reusable
// before/after wrapping layer any Tool can be composed with, without that
// tool's own implementation ever knowing about it - the same "don't touch
// the tool, wrap it" spirit requiresConfirmation already established.

import { record, recordCorrelated } from "../debug.js";
import type { Tool, ToolResult } from "./types.js";

export interface ToolPolicy<TInput = unknown> {
  name: string;
  // Runs before the wrapped tool executes. Whatever it returns is handed
  // only to this SAME policy's own after() below, not shared across
  // policies - e.g. logExecutionPolicy uses this to thread a debug-log
  // request id through to its paired response event, with no shared
  // mutable state that concurrent calls to the same wrapped tool (two
  // sessions both calling `bash` at once, say - STATIC_CATALOG's tool
  // instances are shared across every session) could stomp on.
  before?: (input: TInput) => unknown | Promise<unknown>;
  after?: (input: TInput, result: ToolResult, beforeValue: unknown) => ToolResult | Promise<ToolResult>;
}

// Wraps `tool` with `policies`, applied in order: every policy's before()
// runs first (array order), then the tool itself, then every policy's
// after() (array order - each sees the previous one's already-transformed
// result, so e.g. putting a logging policy before a truncating one means
// the log sees the full output, not the truncated one - see
// logExecutionPolicy's own comment below).
export function wrapTool<TInput>(tool: Tool<TInput>, policies: ToolPolicy<TInput>[]): Tool<TInput> {
  return {
    ...tool,
    async execute(input: TInput): Promise<ToolResult> {
      const beforeValues: unknown[] = [];
      for (const policy of policies) beforeValues.push(await policy.before?.(input));

      let result = await tool.execute(input);

      for (let i = 0; i < policies.length; i++) {
        const after = policies[i].after;
        if (after) result = await after(input, result, beforeValues[i]);
      }
      return result;
    },
  };
}

// Truncates result.result to maxChars, regardless of isError - a runaway
// command's giant error dump deserves the same cap as a giant success
// output. Appends a marker noting how much was cut, same spirit as
// debug.ts's own truncation marker for oversized payloads.
export function truncateOutputPolicy(maxChars: number): ToolPolicy {
  return {
    name: `truncate-output(${maxChars})`,
    after: (_input, result) => {
      if (result.result.length <= maxChars) return result;
      const cut = result.result.length - maxChars;
      return { ...result, result: `${result.result.slice(0, maxChars)}\n…[truncated ${cut} more characters]` };
    },
  };
}

// Records a before/after pair in the debug log (Phase 19) for every call,
// under a distinct source ("tool-wrapper") from agent.ts's own built-in
// tool/tool_result instrumentation - an additional, independently
// inspectable layer, not a duplicate of it. Logs the RAW input/output,
// before any other policy gets a chance to transform it (e.g.
// truncateOutputPolicy) - ordering this policy first in wrapTool()'s list
// keeps the debug log's own record of what actually happened intact even
// when the model-facing result ends up cut down.
export function logExecutionPolicy(toolName: string): ToolPolicy {
  return {
    name: "log-execution",
    before: (input) => record("tool-wrapper", "info", `→ ${toolName} (wrapped)`, JSON.stringify(input)),
    after: (_input, result, reqId) => {
      recordCorrelated(
        reqId as number,
        "tool-wrapper",
        result.isError ? "error" : "info",
        `← ${toolName} (wrapped)`,
        result.result,
      );
      return result;
    },
  };
}

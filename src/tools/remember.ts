// Equivalent to internal/tool/remember.go: writes a piece of memory
// through whatever MemoryStore this deployment is using. The agent should
// use this sparingly, for things the user genuinely wants to carry across
// sessions.

import { z } from "zod";
import type { MemoryStore } from "../memory/types.js";
import { MemoryKind } from "../memory/types.js";
import type { Tool, ToolResult } from "./types.js";

const schema = z.object({
  content: z.string().describe("The text to remember."),
  kind: z.string().optional().describe("Optional category: fact (default), decision, preference."),
  tags: z
    .array(z.string())
    .optional()
    .describe("Optional short tags to make the entry findable later via the recall tool."),
});

export function rememberTool(store: MemoryStore): Tool<z.infer<typeof schema>> {
  return {
    name: "remember",
    description:
      "Record a fact, decision, or preference into the agent's persistent memory so it carries " +
      "across sessions. Use sparingly for things the user genuinely wants to persist (project " +
      "conventions, preferences, important decisions). Don't dump every tool call here.",
    schema,
    async execute({ content, kind, tags }): Promise<ToolResult> {
      await store.save({ time: new Date(), kind: kind || MemoryKind.Fact, content, tags: tags ?? [] });
      return { result: "remembered.", isError: false };
    },
  };
}

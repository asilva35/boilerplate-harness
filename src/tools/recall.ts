// Equivalent to internal/tool/recall.go: surfaces past memory entries
// (typically prior session summaries) that match a query. Returns
// metadata only - the content already embeds the session's file path
// (see recordToEntry in session-files.ts), so the agent can read_file on
// it if it wants the full transcript.

import { z } from "zod";
import { formatDate } from "../memory/date-format.js";
import type { MemoryStore } from "../memory/types.js";
import type { Tool, ToolResult } from "./types.js";

const schema = z.object({
  query: z.string().describe("Substring to match against session tags and summaries (case-insensitive)."),
  limit: z.number().int().positive().optional().describe("Maximum number of session records to return. Defaults to 5."),
});

export function recallTool(store: MemoryStore): Tool<z.infer<typeof schema>> {
  return {
    name: "recall",
    description:
      "Search the agent's persistent memory of past sessions. Returns dates, tags, summaries, and " +
      "file paths for matching sessions - read_file on a returned path to see the full transcript. " +
      "Recent sessions are already in your context as part of the system prompt; check there first.",
    schema,
    async execute({ query, limit }): Promise<ToolResult> {
      const entries = await store.recall(query, limit ?? 5);
      if (entries.length === 0) return { result: "no matches.", isError: false };

      const lines = [`${entries.length} match(es) for "${query}":`];
      for (const entry of entries) {
        const tagsPart = entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
        lines.push(`- ${formatDate(entry.time)} — ${entry.content}${tagsPart}`);
      }
      return { result: lines.join("\n"), isError: false };
    },
  };
}

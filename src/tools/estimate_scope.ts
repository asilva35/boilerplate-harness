// Phase 15: a lightweight self-check the agent can call before deciding
// whether to act directly (bash/read_file/write_file) or delegate_research
// first. Deliberately NOT another LLM call — "liviano" per the migration
// guide - just a deterministic file-count heuristic, cheap and instant,
// giving the model a data point to reason from rather than a verdict to
// follow blindly.

import { z } from "zod";
import type { Tool, ToolResult } from "./types.js";

const schema = z.object({
  description: z.string().describe("One-line description of the task being scoped."),
  files: z
    .array(z.string())
    .describe("Best guess of the file paths this task will need to touch or read, before starting."),
});

export const estimateScopeTool: Tool<z.infer<typeof schema>> = {
  name: "estimate_scope",
  description:
    "Self-check before acting on a task: given a rough guess of which files it touches, reports " +
    "whether it looks local (handle directly), broad (delegate_research first), or wide enough " +
    "that the goal may need clarifying before acting. Call this when unsure how many files or " +
    "areas a task spans - skip it for obviously trivial or obviously broad tasks.",
  schema,
  execute({ description, files }): ToolResult {
    const count = new Set(files).size;
    const verdict =
      count <= 1
        ? "local — handle directly with bash/read_file/write_file, no need to delegate."
        : count <= 4
          ? `touches ${count} files — consider delegate_research first to gather context before acting.`
          : `touches ${count} files — broad enough that delegate_research first is strongly recommended; ` +
            "if the goal itself is still unclear after that, ask a clarifying question before acting.";

    return { result: `scope estimate for "${description}": ${verdict}`, isError: false };
  },
};

// Equivalent to delegate.go's DelegateTool: wraps any Subagent as a
// callable Tool named delegate_<name>, with a single `task` parameter.
// Errors from subagent.run() (e.g. "max turns reached") propagate up and
// are turned into an error ToolResult by ToolRegistry.execute's own
// try/catch - no need to duplicate that here.

import { z } from "zod";
import type { Tool, ToolResult } from "../tools/types.js";
import type { Subagent } from "./types.js";

const schema = z.object({
  task: z.string().describe("Concrete description of what the subagent should do."),
});

export function delegateTool(subagent: Subagent): Tool<z.infer<typeof schema>> {
  return {
    name: `delegate_${subagent.name}`,
    description: subagent.description,
    schema,
    async execute({ task }): Promise<ToolResult> {
      return { result: await subagent.run(task), isError: false };
    },
  };
}

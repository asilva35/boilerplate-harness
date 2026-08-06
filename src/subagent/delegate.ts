// Equivalent to delegate.go's DelegateTool: wraps any Subagent as a
// callable Tool named delegate_<name>, with a single `task` parameter.
// Errors from subagent.run() (e.g. "max turns reached") propagate up and
// are turned into an error ToolResult by ToolRegistry.execute's own
// try/catch - no need to duplicate that here.
//
// Phase 17: before running the subagent, checks the skill registry for
// project rules relevant to this task and digests them into a handful of
// concrete rules, appended to the task text - the subagent still only
// ever sees a `task: string`, never a raw skill document.
//
// Phase 18: maps the subagent's SubagentResult 1:1 into the ToolResult's
// risk/nextRecommended envelope, instead of flattening it into plain text.

import { z } from "zod";
import type { Provider } from "../provider/types.js";
import { digestSkills } from "../skills/digest.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { Tool, ToolResult } from "../tools/types.js";
import type { Subagent } from "./types.js";

const schema = z.object({
  task: z.string().describe("Concrete description of what the subagent should do."),
});

export function delegateTool(
  subagent: Subagent,
  provider: Provider,
  skillRegistry: SkillRegistry,
): Tool<z.infer<typeof schema>> {
  return {
    name: `delegate_${subagent.name}`,
    description: subagent.description,
    schema,
    async execute({ task }): Promise<ToolResult> {
      const digest = await digestSkills(provider, skillRegistry.match(task), task);
      const augmentedTask = digest ? `${task}\n\nRelevant project rules:\n${digest}` : task;
      const { text, risk, nextRecommended } = await subagent.run(augmentedTask);
      return { result: text, isError: false, risk, nextRecommended };
    },
  };
}

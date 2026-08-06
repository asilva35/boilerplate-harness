// Equivalent to internal/subagent/research.go: a read-only investigation
// subagent - read_file only, no bash, a tight turn budget, and its own
// system prompt so it stays on task instead of inheriting the root
// agent's general-purpose one.
//
// Each run() builds a brand new Agent with a fresh ToolRegistry - no
// state carries over between calls, same as Go's Research.Run creating a
// new agent.Agent every time.

import { Agent } from "../agent.js";
import type { Provider } from "../provider/types.js";
import { readFileTool } from "../tools/read_file.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Subagent } from "./types.js";

const SYSTEM_PROMPT = `You are a research subagent. Your job is to investigate the
task you're given and return a concise, factual answer.

Rules:
- Use the tools available to look up information. Prefer fewer, more targeted
  reads over scanning everything.
- Return a short answer with the specific facts requested. No preamble.
- If the answer requires a path or identifier, include it verbatim.
- You have a limited number of tool calls; do not waste them.`;

export class ResearchSubagent implements Subagent {
  readonly name = "research";
  readonly description =
    "Investigate the codebase or filesystem and return a focused answer. Prefer this over " +
    "reading files yourself when the user asks ANY question about the code - 'where is X', " +
    "'how does Y work', 'what does Z look like'. The subagent has read_file access and its own " +
    "context window, so it can explore freely without polluting your conversation. Always pass " +
    "a concrete task description, not just the user's literal question.";

  constructor(private readonly provider: Provider) {}

  async run(task: string): Promise<string> {
    const tools = new ToolRegistry();
    tools.register(readFileTool);

    const agent = new Agent({
      provider: this.provider,
      tools,
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 10,
    });
    return agent.send(task);
  }
}

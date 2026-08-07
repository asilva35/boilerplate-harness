// Equivalent to internal/subagent/research.go: a read-only investigation
// subagent - read_file only by default, no bash, a tight turn budget, and
// its own system prompt so it stays on task instead of inheriting the root
// agent's general-purpose one.
//
// Each run() builds a brand new Agent - no conversation history carries
// over between calls, same as Go's Research.Run creating a new agent.Agent
// every time. The ToolRegistry itself (Phase 23) is built once by the
// caller (tools/catalog.ts's buildToolPack(), from harness.config.json's
// "subagents") and reused across calls - it's stateless, so there's
// nothing to reset between runs.

import { Agent } from "../agent.js";
import type { Provider } from "../provider/types.js";
import type { Risk } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Subagent, SubagentResult } from "./types.js";

const SYSTEM_PROMPT = `You are a research subagent. Your job is to investigate the
task you're given and return a concise, factual answer.

Rules:
- Use the tools available to look up information. Prefer fewer, more targeted
  reads over scanning everything.
- Return a short answer with the specific facts requested. No preamble.
- If the answer requires a path or identifier, include it verbatim.
- You have a limited number of tool calls; do not waste them.

End your answer with exactly these two lines, and nothing after them:

RISK: none|low|high
NEXT: <one short, concrete suggestion for what to do next, or "none">

Use "high" only for something a human should see immediately - a hardcoded
secret or credential, a destructive/irreversible pattern, a clear security
hole. Use "low" for something worth a second look but not urgent. Almost
every investigation is "none" - don't inflate the risk level to seem
thorough.`;

// Parses the trailing "RISK: ...\nNEXT: ..." lines the system prompt
// above requires, same pattern as parseSummaryAndTags in
// summarize-session.ts: a plain text convention instead of structured
// output, since this subagent is a single agent.send() call with no
// side-channel to report through.
function parseRiskAndNext(text: string): SubagentResult {
  const match = text.match(/\n?RISK:\s*(none|low|high)\s*\nNEXT:\s*(.*?)\s*$/i);
  if (!match) return { text: text.trim() };

  const [, riskRaw, nextRaw] = match;
  const risk = riskRaw.toLowerCase() as Risk;
  const next = nextRaw.trim();

  return {
    text: text.slice(0, match.index).trim(),
    risk,
    nextRecommended: next && next.toLowerCase() !== "none" ? next : undefined,
  };
}

export class ResearchSubagent implements Subagent {
  readonly name = "research";
  readonly description =
    "Investigate the codebase or filesystem and return a focused answer. Prefer this over " +
    "reading files yourself when the user asks ANY question about the code - 'where is X', " +
    "'how does Y work', 'what does Z look like'. The subagent has read_file access and its own " +
    "context window, so it can explore freely without polluting your conversation. Always pass " +
    "a concrete task description, not just the user's literal question.";

  constructor(
    private readonly provider: Provider,
    private readonly tools: ToolRegistry,
    // Phase 26: optional per-subagent model override (from tools.json's
    // "subagentModels"), e.g. running research on a cheaper/faster model
    // than the root agent. Undefined means "inherit whatever model the
    // shared Provider is already set to."
    private readonly model?: string,
  ) {}

  async run(task: string): Promise<SubagentResult> {
    // this.provider is the SAME instance the root Agent uses (see
    // tools/catalog.ts's registerSubagents) - Provider.model is a mutable
    // field read at send() time (Phase 25), not a constructor argument, so
    // switching it here really does affect a shared object. Restoring it
    // in `finally` (even if agent.send() throws, e.g. "max turns reached")
    // is what keeps this safe: without it, one delegate_research call
    // would permanently change the root agent's model for the rest of the
    // session, since sends within a session already run sequentially
    // (Agent.loop awaits each tool call before the next), never
    // concurrently against this provider.
    const originalModel = this.provider.model;
    if (this.model) this.provider.setModel(this.model);
    try {
      const agent = new Agent({
        provider: this.provider,
        tools: this.tools,
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 10,
      });
      const text = await agent.send(task);
      return parseRiskAndNext(text);
    } finally {
      if (this.model) this.provider.setModel(originalModel);
    }
  }
}

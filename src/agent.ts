// Reduced equivalent of internal/agent/agent.go: keeps a conversation's
// message history and runs the tool-use loop until the model stops
// requesting tools (or maxTurns is reached).
//
// Phase 3: permission gate. Analogous to a.Confirm in Go — if a tool is
// marked requiresConfirmation and a `confirm` callback is configured, the
// loop pauses before executing it and waits for [y/N]. Without `confirm`
// (or for tools that don't require it), it executes directly, same as Go
// treating `Confirm == nil` as "auto-approve everything."
//
// Phase 4: compaction. Just like a.Compactor in Go, it runs at the start
// of every loop turn — even within the same user turn if there are several
// back-and-forth tool-use round trips. getMessages/setMessages/
// clearMessages expose the history so slash commands (/compact, /clear,
// /history) can read and mutate it from outside the loop.

import { NoCompaction, renderTranscript, type CompactionStrategy } from "./context/compactor.js";
import { record, recordCorrelated } from "./debug.js";
import type { Block, Message, Provider } from "./provider/types.js";
import type { Risk } from "./tools/types.js";
import type { ToolRegistry } from "./tools/registry.js";

export interface AgentOptions {
  provider: Provider;
  tools: ToolRegistry;
  // Phase 14: defaults to "" (not harnessConfig.systemPrompt) - the Agent
  // class deliberately doesn't know about harnessConfig, since a subagent
  // needs its own, different system prompt through the same Provider.
  // Entry points pass harnessConfig.systemPrompt explicitly for the root
  // agent; subagents pass their own constant instead.
  systemPrompt?: string;
  maxTurns?: number;
  onToolCall?: (name: string, rawInput: string) => void;
  onAssistantText?: (text: string) => void;
  onTextDelta?: (chunk: string) => void;
  // Phase 18: fires only for risk "low"/"high" (never "none" - most tool
  // calls have nothing to flag, and firing on every one would bury the
  // signal it's meant to surface). Entry points wire this to something
  // visually distinct from the normal tool-call/result flow.
  onRiskFlag?: (toolName: string, risk: Risk, nextRecommended?: string) => void;
  confirm?: (name: string, rawInput: string) => Promise<boolean> | boolean;
  compactor?: CompactionStrategy;
}

export class Agent {
  // Public (Phase 13): commands.ts needs a Provider to build a Summarize
  // strategy on demand for "/compact summarize" - same reasoning `compactor`
  // below is already public for "/compact <strategy>" to read/replace it.
  // Not readonly since Phase 25: "/provider" swaps the whole backend
  // (Anthropic <-> OpenRouter), not just the model on the existing one -
  // see commands.ts's cmdProvider and CommandContext.switchProvider.
  provider: Provider;
  private readonly tools: ToolRegistry;
  private readonly systemPrompt: string;
  private readonly maxTurns: number;
  private readonly onToolCall?: (name: string, rawInput: string) => void;
  private readonly onAssistantText?: (text: string) => void;
  private readonly onTextDelta?: (chunk: string) => void;
  private readonly onRiskFlag?: (toolName: string, risk: Risk, nextRecommended?: string) => void;
  private readonly confirm?: (name: string, rawInput: string) => Promise<boolean> | boolean;
  compactor: CompactionStrategy;
  private messages: Message[] = [];

  constructor(opts: AgentOptions) {
    this.provider = opts.provider;
    this.tools = opts.tools;
    this.systemPrompt = opts.systemPrompt ?? "";
    this.maxTurns = opts.maxTurns ?? 20;
    this.onToolCall = opts.onToolCall;
    this.onAssistantText = opts.onAssistantText;
    this.onTextDelta = opts.onTextDelta;
    this.onRiskFlag = opts.onRiskFlag;
    this.confirm = opts.confirm;
    this.compactor = opts.compactor ?? new NoCompaction();
  }

  getMessages(): Message[] {
    return this.messages;
  }

  setMessages(messages: Message[]): void {
    this.messages = messages;
  }

  clearMessages(): void {
    this.messages = [];
  }

  // Phase 29 added `blocks` (images at first; Phase 30 generalized it to
  // any Block, since PDF attachments need to append either image blocks
  // -rendered pages- or a text block -extracted content- the exact same
  // way). Optional and additive - every existing caller (index.ts, tui.tsx,
  // ResearchSubagent) passes none and gets the exact pre-Phase-29 single
  // text block. An empty `prompt` is only valid when at least one extra
  // block is attached (the "image with no caption" case); callers still
  // guard against a genuinely empty send before reaching here - see
  // server.ts's socket handler.
  async send(prompt: string, blocks: Block[] = []): Promise<string> {
    const content: Block[] = [];
    if (prompt) content.push({ type: "text", text: prompt });
    content.push(...blocks);
    this.messages.push({ role: "user", content });
    return this.loop();
  }

  private async loop(): Promise<string> {
    const finalText: string[] = [];

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const before = this.messages;
      const compacted = await this.compactor.compact(before);
      if (compacted.length !== before.length) {
        console.log(`[compact] ${before.length} → ${compacted.length} messages`);
        record(
          "compact",
          "info",
          `${before.length} → ${compacted.length} msgs`,
          `--- before (${before.length} msgs) ---\n${renderTranscript(before)}\n` +
            `--- after (${compacted.length} msgs) ---\n${renderTranscript(compacted)}`,
        );
      }
      this.messages = compacted;

      const response = await this.provider.send(
        this.messages,
        this.systemPrompt,
        this.tools.definitions(),
        this.onTextDelta,
      );
      this.messages.push({ role: "assistant", content: response.content });

      const toolResults: Block[] = [];
      let hasToolCall = false;

      for (const block of response.content) {
        if (block.type === "text") {
          if (!block.text) continue;
          this.onAssistantText?.(block.text);
          finalText.push(block.text);
        } else if (block.type === "tool_use") {
          hasToolCall = true;
          this.onToolCall?.(block.toolName, block.toolInput);

          const reqId = record(
            "tool",
            "info",
            `→ ${block.toolName} ${truncate(block.toolInput, 200)}`,
            block.toolInput,
          );

          if (this.tools.requiresConfirmation(block.toolName) && this.confirm) {
            const approved = await this.confirm(block.toolName, block.toolInput);
            if (!approved) {
              recordCorrelated(reqId, "tool", "warn", `denied: ${block.toolName}`);
              toolResults.push({
                type: "tool_result",
                toolUseId: block.toolUseId,
                toolResult: "user denied this tool call",
                isError: true,
              });
              continue;
            }
          }

          const start = Date.now();
          const { result, isError, risk, nextRecommended } = await this.tools.execute(
            block.toolName,
            block.toolInput,
          );
          const elapsed = Date.now() - start;
          recordCorrelated(
            reqId,
            "tool",
            isError ? "error" : "info",
            isError
              ? `← ${block.toolName} error (${elapsed}ms): ${truncate(result, 200)}`
              : `← ${block.toolName} (${elapsed}ms, ${result.length} bytes)`,
            result,
          );

          // Annotate the text that goes back to the model too (not just
          // the side-channel callback below) - the root agent's own
          // reasoning can only react to a risk flag if it's actually in
          // its context, same "inform via text, don't hardcode control
          // flow" approach the Phase 15 delegation heuristic already uses.
          let toolResult = result;
          if (risk && risk !== "none") {
            this.onRiskFlag?.(block.toolName, risk, nextRecommended);
            const next = nextRecommended ? ` next recommended: ${nextRecommended}` : "";
            toolResult = `[risk: ${risk}]${next}\n${result}`;
          }
          toolResults.push({ type: "tool_result", toolUseId: block.toolUseId, toolResult, isError });
        }
      }

      if (response.stopReason !== "tool_use" || !hasToolCall) {
        return finalText.join("\n").trim();
      }

      this.messages.push({ role: "user", content: toolResults });
    }

    throw new Error(`max turns (${this.maxTurns}) reached`);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

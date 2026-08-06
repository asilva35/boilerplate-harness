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

import { NoCompaction, type CompactionStrategy } from "./context/compactor.js";
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
  readonly provider: Provider;
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

  async send(prompt: string): Promise<string> {
    this.messages.push({ role: "user", content: [{ type: "text", text: prompt }] });
    return this.loop();
  }

  private async loop(): Promise<string> {
    const finalText: string[] = [];

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const before = this.messages;
      const compacted = await this.compactor.compact(before);
      if (compacted.length !== before.length) {
        console.log(`[compact] ${before.length} → ${compacted.length} messages`);
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

          if (this.tools.requiresConfirmation(block.toolName) && this.confirm) {
            const approved = await this.confirm(block.toolName, block.toolInput);
            if (!approved) {
              toolResults.push({
                type: "tool_result",
                toolUseId: block.toolUseId,
                toolResult: "user denied this tool call",
                isError: true,
              });
              continue;
            }
          }

          const { result, isError, risk, nextRecommended } = await this.tools.execute(
            block.toolName,
            block.toolInput,
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

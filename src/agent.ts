// Reduced equivalent of internal/agent/agent.go: keeps a conversation's
// message history and runs the tool-use loop until the model stops
// requesting tools (or maxTurns is reached).
//
// Phase 3: permission gate. Analogous to a.Confirm in Go — if a tool is
// marked requiresConfirmation and a `confirm` callback is configured, the
// loop pauses before executing it and waits for [y/N]. Without `confirm`
// (or for tools that don't require it), it executes directly, same as Go
// treating `Confirm == nil` as "auto-approve everything."

import type { Block, Message, Provider } from "./provider/types.js";
import type { ToolRegistry } from "./tools/registry.js";

export interface AgentOptions {
  provider: Provider;
  tools: ToolRegistry;
  maxTurns?: number;
  onToolCall?: (name: string, rawInput: string) => void;
  onAssistantText?: (text: string) => void;
  confirm?: (name: string, rawInput: string) => Promise<boolean> | boolean;
}

export class Agent {
  private readonly provider: Provider;
  private readonly tools: ToolRegistry;
  private readonly maxTurns: number;
  private readonly onToolCall?: (name: string, rawInput: string) => void;
  private readonly onAssistantText?: (text: string) => void;
  private readonly confirm?: (name: string, rawInput: string) => Promise<boolean> | boolean;
  private messages: Message[] = [];

  constructor(opts: AgentOptions) {
    this.provider = opts.provider;
    this.tools = opts.tools;
    this.maxTurns = opts.maxTurns ?? 20;
    this.onToolCall = opts.onToolCall;
    this.onAssistantText = opts.onAssistantText;
    this.confirm = opts.confirm;
  }

  async send(prompt: string): Promise<string> {
    this.messages.push({ role: "user", content: [{ type: "text", text: prompt }] });
    return this.loop();
  }

  private async loop(): Promise<string> {
    const finalText: string[] = [];

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.provider.send(this.messages, this.tools.definitions());
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

          const { result, isError } = await this.tools.execute(block.toolName, block.toolInput);
          toolResults.push({ type: "tool_result", toolUseId: block.toolUseId, toolResult: result, isError });
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

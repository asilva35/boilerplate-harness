// The only file that imports the Anthropic SDK — same as in Go, where
// internal/provider/anthropic.go is "the only file in the harness that
// imports the Anthropic SDK." The rest of the harness only knows the
// generic types defined in ./types.ts.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { harnessConfig } from "../harness-config.js";
import { withRetry } from "./retry.js";
import type { Block, Message, Provider, Response, StopReason, ToolDef } from "./types.js";

export class AnthropicProvider implements Provider {
  private readonly client: Anthropic;
  model: string;

  constructor(model: string = "claude-sonnet-4-6") {
    // maxRetries: 0 - retry/backoff is owned by withRetry() (Phase 9)
    // instead, so there's a single, testable place that decides it.
    this.client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
    this.model = model;
  }

  async send(messages: Message[], tools: ToolDef[] = []): Promise<Response> {
    const response = await withRetry(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: config.maxTokens,
        system: harnessConfig.systemPrompt,
        messages: messages.map(toAnthropicMessage),
        tools: tools.length ? tools.map(toAnthropicTool) : undefined,
      }),
    );

    const content: Block[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool_use",
          toolUseId: block.id,
          toolName: block.name,
          toolInput: JSON.stringify(block.input),
        });
      }
    }

    return { content, stopReason: fromStopReason(response.stop_reason) };
  }
}

function toAnthropicMessage(m: Message): Anthropic.MessageParam {
  return { role: m.role, content: m.content.map(toAnthropicBlock) };
}

function toAnthropicBlock(
  b: Block,
): Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam {
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text };
    case "tool_use":
      return { type: "tool_use", id: b.toolUseId, name: b.toolName, input: JSON.parse(b.toolInput) };
    case "tool_result":
      return { type: "tool_result", tool_use_id: b.toolUseId, content: b.toolResult, is_error: b.isError };
  }
}

function toAnthropicTool(t: ToolDef): Anthropic.Tool {
  return {
    name: t.name,
    description: t.description,
    input_schema: { type: "object", properties: t.inputSchema, required: t.required },
  };
}

function fromStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    default:
      return "other";
  }
}

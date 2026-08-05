// OpenRouter exposes an API compatible with the OpenAI (chat completions)
// format. Careful: OpenAI's tool calling shape is quite different from
// Anthropic's:
//
//   - Anthropic puts tool_use/tool_result as blocks inside a single user/
//     assistant message's `content`.
//   - OpenAI splits it up: the assistant carries `tool_calls` (a separate
//     array from `content`), and each result is its own message with
//     `role: "tool"` and a `tool_call_id`.
//
// toOpenAIMessages() does that "flattening." This is exactly the kind of
// wire-format detail the Provider interface exists to hide from the rest
// of the harness — same spirit as keeping anthropic.go and openai.go
// separate in the original Go project.

import OpenAI from "openai";
import { config } from "../config.js";
import { harnessConfig } from "../harness-config.js";
import { withRetry } from "./retry.js";
import type { Block, Message, Provider, Response, StopReason, ToolDef } from "./types.js";

export class OpenRouterProvider implements Provider {
  private readonly client: OpenAI;
  model: string;

  constructor(model: string = "anthropic/claude-sonnet-4.6") {
    // maxRetries: 0 - retry/backoff is owned by withRetry() (Phase 9)
    // instead, so there's a single, testable place that decides it.
    this.client = new OpenAI({
      apiKey: config.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      maxRetries: 0,
    });
    this.model = model;
  }

  async send(messages: Message[], tools: ToolDef[] = []): Promise<Response> {
    const response = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model,
        max_tokens: config.maxTokens,
        messages: [{ role: "system", content: harnessConfig.systemPrompt }, ...toOpenAIMessages(messages)],
        tools: tools.length ? tools.map(toOpenAITool) : undefined,
      }),
    );

    const choice = response.choices[0];
    const content: Block[] = [];
    if (choice?.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }
    for (const call of choice?.message.tool_calls ?? []) {
      content.push({
        type: "tool_use",
        toolUseId: call.id,
        toolName: call.function.name,
        toolInput: call.function.arguments,
      });
    }

    return { content, stopReason: fromFinishReason(choice?.finish_reason) };
  }
}

function toOpenAIMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [];

  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls = m.content
        .filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({
          id: b.toolUseId,
          type: "function" as const,
          function: { name: b.toolName, arguments: b.toolInput },
        }));

      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // role "user": the text goes in a user message; each tool_result is
    // flattened into its own independent "tool" message.
    const text = m.content
      .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) out.push({ role: "user", content: text });

    for (const b of m.content) {
      if (b.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: b.toolUseId, content: b.toolResult });
      }
    }
  }

  return out;
}

function toOpenAITool(t: ToolDef): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: "object", properties: t.inputSchema, required: t.required },
    },
  };
}

function fromFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    default:
      return "other";
  }
}

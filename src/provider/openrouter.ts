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

  // Retrying (Phase 9) re-opens the stream from scratch - see the same
  // caveat noted in anthropic.ts about a dropped connection potentially
  // replaying already-emitted text through onTextDelta on retry.
  async send(messages: Message[], tools: ToolDef[] = [], onTextDelta?: (chunk: string) => void): Promise<Response> {
    return withRetry(() => this.streamOnce(messages, tools, onTextDelta));
  }

  private async streamOnce(
    messages: Message[],
    tools: ToolDef[],
    onTextDelta?: (chunk: string) => void,
  ): Promise<Response> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: config.maxTokens,
      messages: [{ role: "system", content: harnessConfig.systemPrompt }, ...toOpenAIMessages(messages)],
      tools: tools.length ? tools.map(toOpenAITool) : undefined,
      stream: true,
    });

    let text = "";
    // Unlike Anthropic's single tool_use block, OpenAI's tool_calls arrive
    // as an array where each entry's `index` fragments in over many chunks
    // (id in one, part of the name in another, argument JSON split across
    // several) - accumulate per index, then flatten in order at the end.
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        onTextDelta?.(delta.content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const entry = toolCalls.get(call.index) ?? { id: "", name: "", args: "" };
        if (call.id) entry.id = call.id;
        if (call.function?.name) entry.name += call.function.name;
        if (call.function?.arguments) entry.args += call.function.arguments;
        toolCalls.set(call.index, entry);
      }
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    }

    const content: Block[] = [];
    if (text) content.push({ type: "text", text });
    for (const [, call] of [...toolCalls].sort(([a], [b]) => a - b)) {
      content.push({ type: "tool_use", toolUseId: call.id, toolName: call.name, toolInput: call.args });
    }

    return { content, stopReason: fromFinishReason(finishReason) };
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

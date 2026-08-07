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
import { record, recordCorrelated } from "../debug.js";
import { withRetry } from "./retry.js";
import type { Block, Message, Provider, Response, StopReason, ToolDef, Usage } from "./types.js";

// Phase 25: OpenRouter's own extension to the OpenAI-compatible usage
// object (not part of the openai SDK's typed CompletionUsage) - verified
// live against the real API: requesting stream_options.include_usage
// (the standard OpenAI flag) makes OpenRouter's final chunk include this
// too. `cost` is the actual USD OpenRouter billed for that call, computed
// server-side from whichever underlying model/provider handled it - no
// hand-maintained rate table needed here, unlike AnthropicProvider, since
// OpenRouter proxies many different models under one API and reports the
// real number back directly.
interface OpenRouterUsageExtension {
  cost?: number;
}

export class OpenRouterProvider implements Provider {
  private readonly client: OpenAI;
  readonly kind = "openrouter";
  model: string;
  private total: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  private totalCostUSD = 0;

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

  setModel(name: string): void {
    this.model = name;
  }

  getTotalUsage(): Usage {
    return { ...this.total };
  }

  // Unlike AnthropicProvider, never returns -1 for "unknown model" - every
  // response that reports usage also reports its own real cost, so there's
  // no rate table that could be missing an entry. A response that somehow
  // doesn't report cost just contributes 0 to the running total instead of
  // making the whole estimate "unknown."
  estimatedCostUSD(): number {
    return this.totalCostUSD;
  }

  // Retrying (Phase 9) re-opens the stream from scratch - see the same
  // caveat noted in anthropic.ts about a dropped connection potentially
  // replaying already-emitted text through onTextDelta on retry.
  async send(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] = [],
    onTextDelta?: (chunk: string) => void,
  ): Promise<Response> {
    // Phase 19: one debug event pair per send() call, not per internal
    // retry attempt inside withRetry() - keeps the ring readable.
    const reqId = record(
      "provider",
      "info",
      `→ openrouter.send model=${this.model} msgs=${messages.length} tools=${tools.length}`,
      JSON.stringify(
        {
          model: this.model,
          max_tokens: config.maxTokens,
          system: systemPrompt,
          tools: tools.map((t) => ({ name: t.name, description: t.description })),
          messages,
        },
        null,
        2,
      ),
    );
    const start = Date.now();

    try {
      const response = await withRetry(() => this.streamOnce(messages, systemPrompt, tools, onTextDelta));
      const elapsed = Date.now() - start;
      recordCorrelated(
        reqId,
        "provider",
        "info",
        `← openrouter.send (${elapsed}ms stop=${response.stopReason})`,
        JSON.stringify(
          { elapsed: `${elapsed}ms`, stop_reason: response.stopReason, content: response.content },
          null,
          2,
        ),
      );
      return response;
    } catch (err) {
      const elapsed = Date.now() - start;
      recordCorrelated(
        reqId,
        "provider",
        "error",
        `← openrouter.send error (${elapsed}ms): ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private async streamOnce(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[],
    onTextDelta?: (chunk: string) => void,
  ): Promise<Response> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: config.maxTokens,
      messages: [{ role: "system", content: systemPrompt }, ...toOpenAIMessages(messages)],
      tools: tools.length ? tools.map(toOpenAITool) : undefined,
      stream: true,
      // Phase 25: the standard OpenAI streaming flag for a final usage
      // chunk - verified live that OpenRouter honors it and adds its own
      // `cost` field on top (see OpenRouterUsageExtension above).
      stream_options: { include_usage: true },
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

      // Only the final chunk carries usage (see the include_usage doc
      // comment above the request) - every other chunk's `usage` is null.
      if (chunk.usage) {
        const usage = chunk.usage as OpenAI.CompletionUsage & OpenRouterUsageExtension;
        this.total.inputTokens += usage.prompt_tokens;
        this.total.outputTokens += usage.completion_tokens;
        this.total.cachedTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
        this.totalCostUSD += usage.cost ?? 0;
      }
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

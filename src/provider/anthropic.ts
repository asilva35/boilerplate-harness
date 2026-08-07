// The only file that imports the Anthropic SDK — same as in Go, where
// internal/provider/anthropic.go is "the only file in the harness that
// imports the Anthropic SDK." The rest of the harness only knows the
// generic types defined in ./types.ts.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { record, recordCorrelated } from "../debug.js";
import { withRetry } from "./retry.js";
import type { Block, Message, Provider, Response, StopReason, ToolDef, Usage } from "./types.js";

// Phase 25: per-million-token rates in USD. Update from
// https://www.anthropic.com/pricing when rates change - same
// hand-maintained-table approach as Go's modelPricing, since Anthropic's
// API (unlike OpenRouter's, see openrouter.ts) doesn't report cost back.
// No cache-rate column: this SDK version doesn't implement cache_control
// (see the Usage type's own note), so cachedTokens is always 0 here and
// would only ever multiply out to 0 anyway.
const ANTHROPIC_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  "claude-opus-4-7": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  "claude-opus-4-6": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-haiku-4-5": { inputPerMillion: 1.0, outputPerMillion: 5.0 },
};

export class AnthropicProvider implements Provider {
  private readonly client: Anthropic;
  readonly kind = "anthropic";
  model: string;
  private total: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

  constructor(model: string = "claude-sonnet-4-6") {
    // maxRetries: 0 - retry/backoff is owned by withRetry() (Phase 9)
    // instead, so there's a single, testable place that decides it.
    this.client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
    this.model = model;
  }

  setModel(name: string): void {
    this.model = name;
  }

  getTotalUsage(): Usage {
    return { ...this.total };
  }

  estimatedCostUSD(): number {
    const rates = ANTHROPIC_PRICING[this.model];
    if (!rates) return -1;
    return (this.total.inputTokens * rates.inputPerMillion + this.total.outputTokens * rates.outputPerMillion) / 1_000_000;
  }

  async send(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] = [],
    onTextDelta?: (chunk: string) => void,
  ): Promise<Response> {
    // client.messages.stream() only ever streams the "text" event for text
    // content - a tool_use's input arrives as fragmented raw JSON
    // (inputJson events) that isn't valid to parse until complete, so
    // finalMessage() is still what we build tool_use blocks from below.
    //
    // Phase 19: one debug event pair per send() call, not per internal
    // retry attempt - keeps the ring readable (a flaky connection that
    // retries twice doesn't spam three near-identical request events).
    const reqId = record(
      "provider",
      "info",
      `→ anthropic.send model=${this.model} msgs=${messages.length} tools=${tools.length}`,
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

    // Retrying (Phase 9) re-runs this whole function, including opening a
    // brand new stream - if a connection drops mid-stream after some text
    // already reached onTextDelta, a retry can replay part of that text a
    // second time. Rare in practice (retries only trigger on 429/5xx/
    // connection errors), and simpler than reconciling partial streams.
    let response: Anthropic.Message;
    try {
      response = await withRetry(() => {
        const stream = this.client.messages.stream({
          model: this.model,
          max_tokens: config.maxTokens,
          system: systemPrompt,
          messages: messages.map(toAnthropicMessage),
          tools: tools.length ? tools.map(toAnthropicTool) : undefined,
        });
        if (onTextDelta) stream.on("text", onTextDelta);
        return stream.finalMessage();
      });
    } catch (err) {
      const elapsed = Date.now() - start;
      recordCorrelated(
        reqId,
        "provider",
        "error",
        `← anthropic.send error (${elapsed}ms): ${(err as Error).message}`,
      );
      throw err;
    }
    const elapsed = Date.now() - start;

    this.total.inputTokens += response.usage.input_tokens;
    this.total.outputTokens += response.usage.output_tokens;

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

    recordCorrelated(
      reqId,
      "provider",
      "info",
      `← anthropic.send (${elapsed}ms stop=${response.stop_reason})`,
      JSON.stringify({ elapsed: `${elapsed}ms`, stop_reason: response.stop_reason, content: response.content }, null, 2),
    );

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

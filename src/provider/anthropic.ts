// The only file that imports the Anthropic SDK — same as in Go, where
// internal/provider/anthropic.go is "the only file in the harness that
// imports the Anthropic SDK." The rest of the harness only knows the
// generic types defined in ./types.ts.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { Message, Provider, ProviderResponse } from "./types.js";

export class AnthropicProvider implements Provider {
  private readonly client: Anthropic;
  model: string;

  constructor(model: string = "claude-sonnet-4-6") {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.model = model;
  }

  async send(messages: Message[]): Promise<ProviderResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { text, stopReason: response.stop_reason ?? "other" };
  }
}

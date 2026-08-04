// OpenRouter exposes an API compatible with the OpenAI (chat completions)
// format, so we reuse the `openai` SDK pointed at its base URL. Conceptual
// equivalent of internal/provider/openai.go in the original Go project: a
// second adapter that translates to/from the generic types in ./types.ts
// without the rest of the harness knowing which SDK is behind it.

import OpenAI from "openai";
import { config } from "../config.js";
import type { Message, Provider, ProviderResponse } from "./types.js";

export class OpenRouterProvider implements Provider {
  private readonly client: OpenAI;
  model: string;

  constructor(model: string = "anthropic/claude-sonnet-4.6") {
    this.client = new OpenAI({
      apiKey: config.openrouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
    this.model = model;
  }

  async send(messages: Message[]): Promise<ProviderResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: config.maxTokens,
      messages: [{ role: "system", content: config.systemPrompt }, ...messages],
    });

    const choice = response.choices[0];
    return {
      text: choice?.message.content ?? "",
      stopReason: choice?.finish_reason ?? "other",
    };
  }
}

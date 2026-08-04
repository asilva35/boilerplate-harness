// Provider factory. Equivalent to newProviderByName in main.go: given a
// short name, builds the concrete implementation. Everything else in the
// harness only knows the Provider interface — never AnthropicProvider or
// OpenRouterProvider directly.

import { config } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenRouterProvider } from "./openrouter.js";
import type { Provider } from "./types.js";

export const knownProviders = ["anthropic", "openrouter"] as const;

export function createProvider(
  name: string = config.llmProvider,
  model: string = config.llmModel,
): Provider {
  switch (name) {
    case "anthropic":
      if (!config.anthropicApiKey) {
        throw new Error("missing ANTHROPIC_API_KEY in the environment/.env");
      }
      return model ? new AnthropicProvider(model) : new AnthropicProvider();
    case "openrouter":
      if (!config.openrouterApiKey) {
        throw new Error("missing OPENROUTER_API_KEY in the environment/.env");
      }
      return model ? new OpenRouterProvider(model) : new OpenRouterProvider();
    default:
      throw new Error(
        `unknown provider "${name}" (try one of: ${knownProviders.join(", ")})`,
      );
  }
}

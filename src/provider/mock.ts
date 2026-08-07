// Equivalent to internal/provider/mock.go: a scripted Provider used only in
// tests, so the Agent loop can be exercised without hitting a real API.
// Each call to send() returns the next Response from the script, in order;
// running out of scripted responses means the test itself expected fewer
// turns than the Agent actually took, so it throws instead of hanging.

import type { Message, Provider, Response, ToolDef, Usage } from "./types.js";

// Phase 12: a scripted response can also carry the text chunks it would
// have streamed - MockProvider replays them through onTextDelta before
// returning, so agent.test.ts can assert the Agent wires streaming end to
// end without depending on a real SDK's stream implementation.
//
// Phase 25: also optionally carries usage, so commands.test.ts can script
// realistic /tokens output without needing a real provider.
export interface MockResponse extends Response {
  textDeltas?: string[];
  usage?: Usage;
}

// Fixed, deterministic rates - just enough for tests to assert a non-zero,
// predictable estimatedCostUSD() without needing a real pricing table.
const MOCK_INPUT_PER_MILLION = 1;
const MOCK_OUTPUT_PER_MILLION = 2;

export class MockProvider implements Provider {
  readonly kind = "mock";
  model = "mock";
  private readonly responses: MockResponse[];
  private callCount = 0;
  private total: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

  // Recorded for assertions - what the Agent actually sent on each call.
  // Phase 26: `model` snapshots this.model at call time (not read live off
  // the provider afterward) so a test can tell which model a given call
  // actually used, even if something (a subagent, "/model") changes it
  // again before the assertion runs.
  readonly calls: { messages: Message[]; systemPrompt: string; tools: ToolDef[]; model: string }[] = [];

  constructor(responses: MockResponse[]) {
    this.responses = responses;
  }

  setModel(name: string): void {
    this.model = name;
  }

  getTotalUsage(): Usage {
    return { ...this.total };
  }

  estimatedCostUSD(): number {
    return (this.total.inputTokens * MOCK_INPUT_PER_MILLION + this.total.outputTokens * MOCK_OUTPUT_PER_MILLION) / 1_000_000;
  }

  async send(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] = [],
    onTextDelta?: (chunk: string) => void,
  ): Promise<Response> {
    // Snapshot the array: the Agent keeps mutating the same messages array
    // between turns, so recording the reference as-is would make every
    // past call's `messages` reflect the final state instead of what was
    // actually sent at the time.
    this.calls.push({ messages: [...messages], systemPrompt, tools, model: this.model });
    const response = this.responses[this.callCount];
    if (!response) {
      throw new Error(`MockProvider: no scripted response for call #${this.callCount + 1}`);
    }
    this.callCount++;
    if (response.textDeltas && onTextDelta) {
      for (const chunk of response.textDeltas) onTextDelta(chunk);
    }
    if (response.usage) {
      this.total.inputTokens += response.usage.inputTokens;
      this.total.outputTokens += response.usage.outputTokens;
      this.total.cachedTokens += response.usage.cachedTokens;
    }
    return response;
  }
}

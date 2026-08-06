// Equivalent to internal/provider/mock.go: a scripted Provider used only in
// tests, so the Agent loop can be exercised without hitting a real API.
// Each call to send() returns the next Response from the script, in order;
// running out of scripted responses means the test itself expected fewer
// turns than the Agent actually took, so it throws instead of hanging.

import type { Message, Provider, Response, ToolDef } from "./types.js";

// Phase 12: a scripted response can also carry the text chunks it would
// have streamed - MockProvider replays them through onTextDelta before
// returning, so agent.test.ts can assert the Agent wires streaming end to
// end without depending on a real SDK's stream implementation.
export interface MockResponse extends Response {
  textDeltas?: string[];
}

export class MockProvider implements Provider {
  readonly model = "mock";
  private readonly responses: MockResponse[];
  private callCount = 0;

  // Recorded for assertions - what the Agent actually sent on each call.
  readonly calls: { messages: Message[]; systemPrompt: string; tools: ToolDef[] }[] = [];

  constructor(responses: MockResponse[]) {
    this.responses = responses;
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
    this.calls.push({ messages: [...messages], systemPrompt, tools });
    const response = this.responses[this.callCount];
    if (!response) {
      throw new Error(`MockProvider: no scripted response for call #${this.callCount + 1}`);
    }
    this.callCount++;
    if (response.textDeltas && onTextDelta) {
      for (const chunk of response.textDeltas) onTextDelta(chunk);
    }
    return response;
  }
}

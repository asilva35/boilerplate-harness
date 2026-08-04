// Equivalent to internal/provider/mock.go: a scripted Provider used only in
// tests, so the Agent loop can be exercised without hitting a real API.
// Each call to send() returns the next Response from the script, in order;
// running out of scripted responses means the test itself expected fewer
// turns than the Agent actually took, so it throws instead of hanging.

import type { Message, Provider, Response, ToolDef } from "./types.js";

export class MockProvider implements Provider {
  readonly model = "mock";
  private readonly responses: Response[];
  private callCount = 0;

  // Recorded for assertions - what the Agent actually sent on each call.
  readonly calls: { messages: Message[]; tools: ToolDef[] }[] = [];

  constructor(responses: Response[]) {
    this.responses = responses;
  }

  async send(messages: Message[], tools: ToolDef[] = []): Promise<Response> {
    // Snapshot the array: the Agent keeps mutating the same messages array
    // between turns, so recording the reference as-is would make every
    // past call's `messages` reflect the final state instead of what was
    // actually sent at the time.
    this.calls.push({ messages: [...messages], tools });
    const response = this.responses[this.callCount];
    if (!response) {
      throw new Error(`MockProvider: no scripted response for call #${this.callCount + 1}`);
    }
    this.callCount++;
    return response;
  }
}

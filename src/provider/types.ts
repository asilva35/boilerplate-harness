// Phase 2: a message's content stops being a plain string and becomes an
// array of blocks (text / tool_use / tool_result) - as the Phase 1 comment
// anticipated. This is the equivalent of api.Block / api.Message in
// internal/api/types.go: a generic shape that each provider translates
// to/from its own SDK's format. Anthropic and OpenAI-compatible
// (OpenRouter) represent tool calling quite differently under the hood;
// this type is what lets the rest of the harness stay oblivious to that.

export type Role = "user" | "assistant";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; toolName: string; toolInput: string } // toolInput: raw JSON, pass-through
  | { type: "tool_result"; toolUseId: string; toolResult: string; isError: boolean };

export interface Message {
  role: Role;
  content: Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema "properties"
  required: string[];
}

export type StopReason = "end_turn" | "tool_use" | "other";

export interface Response {
  content: Block[];
  stopReason: StopReason;
}

// Analogous to Go's Provider interface:
//
//   type Provider interface {
//       Send(ctx context.Context, messages []Message, tools []ToolDef) (Response, error)
//       Model() string
//       SetModel(name string)
//   }
export interface Provider {
  readonly model: string;
  send(messages: Message[], tools?: ToolDef[]): Promise<Response>;
}

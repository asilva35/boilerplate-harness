// Minimal types for Phase 1: plain text only, no tools yet.
// Reduced equivalent of internal/api/types.go (Role, Message) and
// internal/provider/provider.go (the Provider interface) from the Go
// project.
//
// Go uses a Message struct with Content []Block because a single message
// can mix text, tool_use, and tool_result. Here, without tools yet, content
// is a plain string — the block abstraction lands in Phase 2.

export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export interface ProviderResponse {
  text: string;
  stopReason: string;
}

// Analogous to Go's Provider interface:
//
//   type Provider interface {
//       Send(ctx context.Context, messages []Message, tools []ToolDef) (Response, error)
//       Model() string
//       SetModel(name string)
//   }
//
// In TS, `ctx context.Context` has no direct equivalent: Node uses
// AbortSignal for cancellation, which we'll add later if needed.
export interface Provider {
  readonly model: string;
  send(messages: Message[]): Promise<ProviderResponse>;
}

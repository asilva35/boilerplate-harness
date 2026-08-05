// Mirrors the WebSocket protocol defined in ../../../src/server.ts (Phase 6)
// and the Message/Block shape from ../../../src/provider/types.ts. Kept as
// a local copy on purpose: this subproject only speaks the wire protocol
// over the socket, it doesn't share TypeScript types across the process
// boundary with the harness backend.

export type Role = "user" | "assistant";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; toolName: string; toolInput: string }
  | { type: "tool_result"; toolUseId: string; toolResult: string; isError: boolean };

export interface Message {
  role: Role;
  content: Block[];
}

export type ServerMessage =
  | { type: "history"; messages: Message[] }
  | { type: "user_text"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: string }
  | { type: "confirm_request"; name: string; input: string }
  | { type: "mode"; mode: "thinking" | "idle" }
  | { type: "error"; message: string };

export type ClientMessage = { type: "input"; line: string } | { type: "confirm_response"; approved: boolean };

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

// Mirrors the WebSocket protocol defined in ../../../src/server.ts (Phase 6)
// and the Message/Block shape from ../../../src/provider/types.ts. Kept as
// a local copy on purpose: this subproject only speaks the wire protocol
// over the socket, it doesn't share TypeScript types across the process
// boundary with the harness backend.

export type Role = "user" | "assistant";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; toolName: string; toolInput: string }
  | { type: "tool_result"; toolUseId: string; toolResult: string; isError: boolean }
  // Phase 29: data is raw base64, no "data:<mediaType>;base64," prefix -
  // callers that need a renderable <img src> build that themselves (see
  // useHarnessSocket.ts).
  | { type: "image"; mediaType: string; data: string };

// A single image attachment, sent in a ClientMessage's "input.images" and
// echoed back in a ServerMessage's "user_text.images" - same shape as
// Block's "image" variant minus the discriminant, since neither the input
// form nor the echo needs it.
export interface ImageAttachment {
  mediaType: string;
  data: string;
}

// Phase 30: a PDF attachment, sent in a ClientMessage's "input.documents" -
// mediaType is always "application/pdf" for now. Unlike ImageAttachment,
// the server never echoes the raw bytes back (see DocumentMeta below) -
// only what the server derived from it (extracted text as a plain "text"
// Block, or rendered pages merged into the same "images" field
// ImageAttachment already uses) shows up on the wire again.
export interface DocumentAttachment {
  filename: string;
  mediaType: string;
  data: string;
}

// What ServerMessage's "user_text.documents" carries - just enough to
// render a compact "a PDF was attached" chip live, not the bytes.
export interface DocumentMeta {
  filename: string;
  mediaType: string;
}

export interface Message {
  role: Role;
  content: Block[];
}

// Mirrors src/debug.ts's DebugEvent, except `time` arrives as an ISO
// string over the wire (JSON has no Date type) instead of a Date.
export interface DebugEvent {
  id: number;
  correlatedId: number;
  time: string;
  source: string;
  level: "info" | "warn" | "error";
  message: string;
  payload: string;
}

export type ServerMessage =
  | { type: "history"; messages: Message[] }
  | { type: "user_text"; text: string; images?: ImageAttachment[]; documents?: DocumentMeta[] }
  | { type: "assistant_text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; input: string }
  | { type: "risk_flag"; name: string; risk: "none" | "low" | "high"; nextRecommended?: string }
  | { type: "debug_event"; event: DebugEvent }
  | { type: "confirm_request"; name: string; input: string; diff?: string }
  | { type: "mode"; mode: "thinking" | "idle" }
  | { type: "error"; message: string }
  | { type: "command_output"; text: string };

export type ClientMessage =
  | { type: "input"; line: string; images?: ImageAttachment[]; documents?: DocumentAttachment[] }
  | { type: "confirm_response"; approved: boolean };

// Mirrors src/session/manager.ts's SessionSummary (Phase 27) - the shape
// GET /api/sessions returns, one entry per session the server process
// currently holds.
export interface SessionSummary {
  id: string;
  userId: string;
  role: string;
  profile: string;
  kind: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  estimatedCostUSD: number;
  lastMessage: string;
}

// Mirrors src/history/types.ts's ChatSummary (Phase 28) - the shape
// GET /api/chats returns, one entry per saved conversation. Unlike
// SessionSummary above, this survives a server restart (it's the on-disk
// archive, not the live SessionManager).
export interface ChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  userId: string;
  role: string;
  profile: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

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
  | { type: "user_text"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; input: string }
  | { type: "risk_flag"; name: string; risk: "none" | "low" | "high"; nextRecommended?: string }
  | { type: "debug_event"; event: DebugEvent }
  | { type: "confirm_request"; name: string; input: string; diff?: string }
  | { type: "mode"; mode: "thinking" | "idle" }
  | { type: "error"; message: string }
  | { type: "command_output"; text: string };

export type ClientMessage = { type: "input"; line: string } | { type: "confirm_response"; approved: boolean };

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

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

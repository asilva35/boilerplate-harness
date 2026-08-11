// WebSocket wire protocol shared between server.ts and session/manager.ts.
// Split out of server.ts in Phase 20 so SessionManager (which builds the
// per-session broadcast/confirm callbacks) can speak the same types
// without importing from server.ts itself.

import type { Agent } from "../agent.js";
import type { DebugEvent } from "../debug.js";
import type { Risk } from "../tools/types.js";

// Messages traveling server → client. `history` hydrates a new tab with
// the conversation already in progress, reusing the same
// Message[]/Block[] that agent.getMessages() exposes - no parallel log
// kept around.
export type ServerMessage =
  | { type: "history"; messages: ReturnType<Agent["getMessages"]> }
  // Phase 29: images echo the same base64 the client attached, so every
  // tab sees the same attachment - not just the id/name of some server-
  // side file, since there isn't one (nothing is written to disk until
  // Phase 28's chat-history archive picks it up from agent.getMessages()).
  | { type: "user_text"; text: string; images?: { mediaType: string; data: string }[] }
  | { type: "assistant_text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; input: string }
  | { type: "risk_flag"; name: string; risk: Risk; nextRecommended?: string }
  | { type: "debug_event"; event: DebugEvent }
  | { type: "confirm_request"; name: string; input: string; diff?: string }
  | { type: "mode"; mode: "thinking" | "idle" }
  | { type: "error"; message: string }
  | { type: "command_output"; text: string };

// Messages client → server. `input` covers both normal messages and "/"
// commands - the server dispatches them the same way index.ts does
// (runCommand first, agent.send if it wasn't a command). `images` (Phase
// 29) is optional and only ever meaningful for a non-command `line` - a
// "/" command ignores it, same as it already ignores everything but the
// text.
export type ClientMessage =
  | { type: "input"; line: string; images?: { mediaType: string; data: string }[] }
  | { type: "confirm_response"; approved: boolean };

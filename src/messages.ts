// Small formatting helpers over Message[]/Block, shared by commands.ts's
// /history and session/manager.ts's summarizeSession() (Phase 27) - split
// out on its own so the session layer doesn't need to import the command
// layer just to reuse "how do we render a message compactly."

import type { Block, Message } from "./provider/types.js";

export function summarizeBlock(b: Block): string {
  switch (b.type) {
    case "text":
      return truncate(b.text.replace(/\s+/g, " "), 60);
    case "tool_use":
      return `[tool_use ${b.toolName}]`;
    case "tool_result":
      return `[tool_result ${b.isError ? "error" : "ok"}]`;
  }
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

// One-line preview of the most recent message - used by the session
// dashboard (Phase 27) so a session with a long history still shows up as
// a single readable row.
export function lastMessagePreview(messages: Message[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "(no messages yet)";
  return `[${last.role}] ${last.content.map(summarizeBlock).join(" ")}`;
}

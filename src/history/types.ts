// Phase 28: what the user sees and manages in the web "Chats" list - the
// browsing/naming/pinning/export surface, distinct from both agent memory
// (Phase 16, what the *agent* remembers between sessions) and the Phase 27
// dashboard (live, in-memory sessions this process currently holds).

import type { Message } from "../provider/types.js";

export interface ChatSummary {
  readonly id: string;
  title: string;
  pinned: boolean;
  readonly userId: string;
  readonly role: string;
  readonly profile: string;
  readonly updatedAt: string; // ISO 8601 - JSON has no Date type
  readonly messageCount: number;
  readonly lastMessage: string;
}

export interface ChatRecord extends ChatSummary {
  readonly messages: Message[];
}

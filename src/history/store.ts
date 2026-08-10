// Disk-backed archive of saved conversations, one JSON file per chat under
// <root>/<id>.json plus an index.json summarizing all of them (same
// two-tier shape as memory/session-files.ts's Store, for the same reason:
// listing shouldn't require reading every full message array off disk).
//
// Distinct from memory/session-files.ts (Phase 16, what the *agent*
// remembers - short summaries the model reads back) and from
// session/manager.ts's SessionSummary (Phase 27, live in-process sessions
// only). This is the user-facing, persisted-across-restarts archive: full
// transcripts, an editable title, and a pinned flag.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigError } from "../errors.js";
import { lastMessagePreview } from "../messages.js";
import type { Message } from "../provider/types.js";
import type { ChatRecord, ChatSummary } from "./types.js";

const DEFAULT_ROOT = path.join(".harness", "chats");
const TITLE_LENGTH = 60;

// Session ids reach this store from a client-controlled `?session=` query
// param (see server.ts) and get turned directly into filenames below - an
// id like "../../etc/passwd" must never be allowed to escape `root`. Real
// ids are always crypto.randomUUID() (see useHarnessSocket.ts), which
// satisfies this trivially; anything else is rejected rather than sanitized,
// same "fail closed" preference the rest of this project uses for
// untrusted input (e.g. resolveRoleTools in harness-config.ts).
function isSafeChatId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,200}$/.test(id);
}

export class ChatHistoryStore {
  private readonly index = new Map<string, ChatSummary>();

  private constructor(private readonly root: string) {}

  static async open(root: string = DEFAULT_ROOT): Promise<ChatHistoryStore> {
    await mkdir(root, { recursive: true });
    const store = new ChatHistoryStore(root);
    await store.loadIndex();
    return store;
  }

  private async loadIndex(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.root, "index.json"), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const doc = JSON.parse(raw) as { chats?: ChatSummary[] };
    for (const summary of doc.chats ?? []) this.index.set(summary.id, summary);
  }

  private async flushIndex(): Promise<void> {
    const chats = [...this.index.values()];
    await writeFile(path.join(this.root, "index.json"), JSON.stringify({ chats }, null, 2), "utf-8");
  }

  private recordPath(id: string): string {
    return path.join(this.root, `${id}.json`);
  }

  // Pinned chats first, then most-recently-updated - keeps the ones you
  // deliberately kept visible from scrolling off under a busy day's chats.
  list(): ChatSummary[] {
    return [...this.index.values()].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  async get(id: string): Promise<ChatRecord | null> {
    if (!isSafeChatId(id)) return null;
    try {
      const raw = await readFile(this.recordPath(id), "utf-8");
      return JSON.parse(raw) as ChatRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  // Called after every completed turn (server.ts) and once more per
  // session on shutdown as a safety net (SIGINT handler) - see the guide's
  // "at close, or periodically." An unsafe or empty-messages input is a
  // silent no-op rather than an error: the live conversation must never
  // fail a turn just because its archive copy couldn't be written.
  async upsert(input: { id: string; userId: string; role: string; profile: string; messages: Message[] }): Promise<void> {
    if (input.messages.length === 0) return;
    if (!isSafeChatId(input.id)) return;

    const existing = this.index.get(input.id);
    const record: ChatRecord = {
      id: input.id,
      // A rename (see update() below) sticks across every later turn -
      // only the very first save picks a title from the conversation.
      title: existing?.title ?? defaultTitle(input.messages),
      pinned: existing?.pinned ?? false,
      userId: input.userId,
      role: input.role,
      profile: input.profile,
      updatedAt: new Date().toISOString(),
      messageCount: input.messages.length,
      lastMessage: lastMessagePreview(input.messages),
      messages: input.messages,
    };

    await writeFile(this.recordPath(input.id), JSON.stringify(record, null, 2), "utf-8");
    const { messages: _messages, ...summary } = record;
    this.index.set(input.id, summary);
    await this.flushIndex();
  }

  // Backs PATCH /api/chats/:id - rename and/or pin. Throws ConfigError for
  // an id this store has never seen (the route below turns that into a
  // 404), rather than silently creating a summary with no transcript
  // behind it.
  async update(id: string, changes: { title?: string; pinned?: boolean }): Promise<ChatSummary> {
    const summary = this.index.get(id);
    if (!summary) throw new ConfigError(`no saved chat with id "${id}"`);

    const updated: ChatSummary = { ...summary, ...changes };
    this.index.set(id, updated);
    await this.flushIndex();

    // Keep the full record file in sync too, so a later export reflects
    // the rename/pin instead of the title/flag it had when last saved.
    const record = await this.get(id);
    if (record) await writeFile(this.recordPath(id), JSON.stringify({ ...record, ...changes }, null, 2), "utf-8");

    return updated;
  }
}

function defaultTitle(messages: Message[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.content.find((b) => b.type === "text");
    if (text && text.type === "text" && text.text.trim()) {
      const flat = text.text.trim().replace(/\s+/g, " ");
      return flat.length <= TITLE_LENGTH ? flat : flat.slice(0, TITLE_LENGTH) + "…";
    }
  }
  return "New chat";
}

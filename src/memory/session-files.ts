// Equivalent to internal/memory/sessionfiles.go: the default Store - one
// markdown file per session under <root>/sessions/, with <root>/index.json
// as a fast-lookup layer over them. Both are human-readable and
// git-friendly (though .harness/ itself is gitignored - see the note
// there); the index lets recall() filter without opening every session
// file.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatDateTime, formatFilenameStamp } from "./date-format.js";
import type { Entry, MemoryStore } from "./types.js";
import { MemoryKind } from "./types.js";

// Caps how many recent sessions get summarised into the system prompt.
// Bigger = more context auto-loaded per session, more tokens spent on
// every turn (or every cached read, with prompt caching).
const PREAMBLE_SESSION_COUNT = 5;

interface SessionRecord {
  path: string;
  date: Date;
  summary: string;
  tags: string[];
}

export class SessionFiles implements MemoryStore {
  private index: SessionRecord[] = [];
  // In-memory entries gathered this session, flushed to disk only on
  // close() - drafts are cheap, and per-save file writes during a busy
  // session would be needless churn.
  private draft: Entry[] = [];
  private readonly sessionStart = new Date();

  private constructor(private readonly root: string) {}

  // Opens (or creates) the memory directory at root and loads the index.
  // Missing sessions referenced in the index get pruned silently - drift
  // between disk and index is fixed in place instead of surfacing as
  // errors at recall time.
  static async open(root: string): Promise<SessionFiles> {
    await mkdir(path.join(root, "sessions"), { recursive: true });
    const store = new SessionFiles(root);
    await store.loadIndex();
    await store.pruneMissing();
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
    const doc = JSON.parse(raw) as { sessions?: (Omit<SessionRecord, "date"> & { date: string })[] };
    this.index = (doc.sessions ?? []).map((r) => ({ ...r, date: new Date(r.date) }));
  }

  private async pruneMissing(): Promise<void> {
    const kept: SessionRecord[] = [];
    for (const record of this.index) {
      if (await fileExists(path.join(this.root, record.path))) kept.push(record);
    }
    this.index = kept;
  }

  private async flushIndex(): Promise<void> {
    const data = JSON.stringify({ sessions: this.index }, null, 2);
    await writeFile(path.join(this.root, "index.json"), data, "utf-8");
  }

  async save(entry: Entry): Promise<void> {
    this.draft.push(entry);
  }

  // Walks the index and returns up to `limit` session records whose
  // summary or tags match the query. Match is a case-insensitive
  // substring scan, ordered most-recent first - enough for sub-thousand-
  // session histories.
  async recall(query: string, limit: number): Promise<Entry[]> {
    if (limit <= 0) limit = 5;
    const q = query.trim().toLowerCase();
    const candidates = [...this.index].sort((a, b) => b.date.getTime() - a.date.getTime());

    const out: Entry[] = [];
    for (const record of candidates) {
      if (q && !matches(record, q)) continue;
      out.push(recordToEntry(record));
      if (out.length >= limit) break;
    }
    return out;
  }

  // Returns the last PREAMBLE_SESSION_COUNT session summaries as a
  // compact block ready to concatenate to the system prompt. Bounded size
  // so a long history of sessions doesn't bloat the per-turn token cost.
  async preamble(): Promise<string> {
    if (this.index.length === 0) return "";
    const records = [...this.index]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, PREAMBLE_SESSION_COUNT);

    let out = "\n\n# Recent sessions (most recent first)\n\n";
    for (const record of records) {
      out += `- ${formatDateTime(record.date)}`;
      if (record.tags.length > 0) out += ` (${record.tags.join(", ")})`;
      out += `: ${record.summary}\n`;
    }
    return out;
  }

  // Flushes the current session draft to a markdown file and adds a
  // record to index.json. An empty draft (no save() calls) is a no-op -
  // empty sessions shouldn't pollute the index. Safe to call multiple
  // times; only the first call has any effect.
  async close(): Promise<void> {
    if (this.draft.length === 0) return;

    const { summary, tags, body } = assembleSession(this.sessionStart, this.draft);
    const rel = path.join("sessions", `${formatFilenameStamp(this.sessionStart)}.md`);
    await writeFile(path.join(this.root, rel), body, "utf-8");

    this.index.push({ path: rel, date: this.sessionStart, summary, tags });
    await this.flushIndex();
    this.draft = [];
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function matches(record: SessionRecord, query: string): boolean {
  if (record.summary.toLowerCase().includes(query)) return true;
  return record.tags.some((t) => t.toLowerCase().includes(query));
}

function recordToEntry(record: SessionRecord): Entry {
  return {
    time: record.date,
    kind: MemoryKind.SessionSummary,
    content: `[${record.path}] ${record.summary}`,
    tags: record.tags,
  };
}

// Turns the in-progress draft into (summary, tags, body). The
// session-summary entry (if any) becomes the file header + the index
// record; everything else is grouped by kind into sections of the body.
function assembleSession(sessionStart: Date, draft: Entry[]): { summary: string; tags: string[]; body: string } {
  let summary = "(no summary)";
  let tags: string[] = [];
  const rest: Entry[] = [];

  for (const entry of draft) {
    if (entry.kind === MemoryKind.SessionSummary) {
      summary = entry.content;
      tags = entry.tags;
      continue;
    }
    rest.push(entry);
  }

  let body = `# ${formatDateTime(sessionStart)}\n`;
  if (tags.length > 0) body += `tags: ${tags.join(", ")}\n`;
  body += "\n## Summary\n\n" + summary + "\n";

  if (rest.length === 0) return { summary, tags, body };

  const grouped = groupByKind(rest);
  for (const kind of [MemoryKind.Fact, MemoryKind.Decision, MemoryKind.Preference]) {
    const entries = grouped.get(kind);
    if (!entries || entries.length === 0) continue;
    body += `\n## ${titleCase(kind)}s\n\n`;
    for (const entry of entries) body += `- ${entry.content}\n`;
    grouped.delete(kind);
  }

  // Anything with a custom or empty kind falls under Notes so it's still
  // preserved in the file even if it doesn't match the canonical kinds.
  const extras = [...grouped.values()].flat();
  if (extras.length > 0) {
    body += "\n## Notes\n\n";
    for (const entry of extras) {
      body += entry.kind ? `- (${entry.kind}) ${entry.content}\n` : `- ${entry.content}\n`;
    }
  }

  return { summary, tags, body };
}

function groupByKind(entries: Entry[]): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = out.get(entry.kind) ?? [];
    list.push(entry);
    out.set(entry.kind, list);
  }
  return out;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

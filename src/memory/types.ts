// Equivalent to internal/memory/store.go: the persistence layer for
// context that survives a process restart. Three operations cover the
// natural rhythm of agent memory: write (save), search (recall), and the
// always-loaded preface that goes into the system prompt at session start
// (preamble).

export interface Entry {
  time: Date;
  kind: string;
  content: string;
  tags: string[];
}

// Recognised kind values. Implementations are free to accept anything
// else; these are the conventions the rest of the harness uses.
export const MemoryKind = {
  Fact: "fact",
  Decision: "decision",
  SessionSummary: "session-summary",
  Preference: "preference",
} as const;

export interface MemoryStore {
  save(entry: Entry): Promise<void>;
  recall(query: string, limit: number): Promise<Entry[]>;
  preamble(): Promise<string>;
}

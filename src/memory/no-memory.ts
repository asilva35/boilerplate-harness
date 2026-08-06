// Equivalent to Go's NoMemory: the do-nothing fallback. Every method
// succeeds with empty output. Used when persistent memory can't be set up
// (e.g. the .harness directory can't be created) - the harness should
// still boot and run normally, just without cross-session memory.

import type { Entry, MemoryStore } from "./types.js";

export class NoMemory implements MemoryStore {
  async save(_entry: Entry): Promise<void> {}

  async recall(_query: string, _limit: number): Promise<Entry[]> {
    return [];
  }

  async preamble(): Promise<string> {
    return "";
  }
}

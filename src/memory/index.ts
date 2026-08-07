// Entry-point-facing wiring for persistent memory, shared by index.ts,
// tui.tsx, and server.ts so the "create the store, flush it at shutdown"
// dance isn't duplicated three times - same reasoning as
// registerCatalogTools/buildCompactor in Phase 8.

import { NoMemory } from "./no-memory.js";
import { SessionFiles } from "./session-files.js";
import { summarizeSession } from "./summarize-session.js";
import { MemoryKind } from "./types.js";
import type { MemoryStore } from "./types.js";
import type { Message, Provider } from "../provider/types.js";

export type { MemoryStore, Entry } from "./types.js";
export { MemoryKind } from "./types.js";

export interface MemorySession {
  store: MemoryStore;
  // Flushes the session's draft entries to disk. A no-op for NoMemory -
  // callers don't need to know which concrete store they got (mirrors why
  // Go keeps Close() off the Store interface, but on the concrete type).
  close: () => Promise<void>;
}

// Opens the on-disk memory store at `root` (".harness" by default, same
// as Go). Falls back to NoMemory - logging a warning, never throwing - if
// the directory can't be set up, so a permissions issue or a read-only
// filesystem doesn't prevent the harness from starting.
export async function createMemoryStore(root = ".harness"): Promise<MemorySession> {
  try {
    const sessionFiles = await SessionFiles.open(root);
    return { store: sessionFiles, close: () => sessionFiles.close() };
  } catch (err) {
    console.error(`memory: ${(err as Error).message} (continuing without persistent memory)`);
    return { store: new NoMemory(), close: async () => {} };
  }
}

// Called once at shutdown: summarizes the session via the model (if
// anything was said) and persists it, then flushes the store. Best-effort
// throughout - a failure here should never block the process from
// exiting cleanly.
export async function finalizeSession(provider: Provider, messages: Message[], session: MemorySession): Promise<void> {
  try {
    if (messages.length > 0) {
      const { summary, tags } = await summarizeSession(provider, messages);
      await session.store.save({ time: new Date(), kind: MemoryKind.SessionSummary, content: summary, tags });
    }
    await session.close();
  } catch (err) {
    console.error(`memory: failed to save session: ${(err as Error).message}`);
  }
}

// Phase 20 variant for server.ts: with a SessionManager, a single process
// now holds N independent conversations instead of one. Summarizes each
// one (skipping empties) into its own SessionSummary entry in the shared
// store, then closes the store once. Each summary is best-effort on its
// own - one conversation failing to summarize shouldn't lose the others -
// but close() always runs so whatever did succeed gets flushed.
//
// Phase 25: each session brings its own Provider now (no more single
// shared instance every session used), so summarizing session A must use
// session A's own provider/model, not some arbitrary "the one built at
// startup" - summarizing every session with the wrong backend/model would
// silently work but be a real correctness gap (wrong pricing tier, wrong
// system-prompt-less capability assumptions for whatever the user picked).
export async function finalizeSessions(
  sessions: { provider: Provider; messages: Message[] }[],
  session: MemorySession,
): Promise<void> {
  for (const { provider, messages } of sessions) {
    if (messages.length === 0) continue;
    try {
      const { summary, tags } = await summarizeSession(provider, messages);
      await session.store.save({ time: new Date(), kind: MemoryKind.SessionSummary, content: summary, tags });
    } catch (err) {
      console.error(`memory: failed to summarize a session: ${(err as Error).message}`);
    }
  }
  try {
    await session.close();
  } catch (err) {
    console.error(`memory: failed to close store: ${(err as Error).message}`);
  }
}

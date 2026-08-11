// Phase 31: a lightweight safety net for write_file (Phase 3) - before
// overwriting an existing file, its current content gets snapshotted here
// so /rollback (commands.ts) can undo an approved-but-regretted write.
// Process-wide, not session-scoped - same reasoning as debug.ts's ring
// buffer (Phase 19): a write from any session's write_file call is
// equally worth protecting, and there's exactly one filesystem underneath
// every session anyway.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROOT = path.join(".harness", "backups");

export class BackupStore {
  constructor(private readonly root: string = DEFAULT_ROOT) {}

  // Filenames are "<timestamp>-<encodeURIComponent(resolved path)>", flat
  // under `root`. encodeURIComponent guarantees no "/" (or "..") survives
  // into the filename, so a `targetPath` shaped like a traversal attempt
  // can't escape `root` the way a raw path.join would - cheap to keep
  // honest even though targetPath is already trusted input here
  // (write_file requires approval before this ever runs). `path.resolve`
  // first so "src/foo.ts" and "./src/foo.ts" - the same file, spelled
  // differently - back up and roll back as the same entry.
  private key(targetPath: string): string {
    return encodeURIComponent(path.resolve(targetPath));
  }

  async save(targetPath: string, previousContent: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const filename = `${Date.now()}-${this.key(targetPath)}`;
    await writeFile(path.join(this.root, filename), previousContent, "utf-8");
  }

  // Returns the most recently saved backup's content for `targetPath`, or
  // null if none exists. Filenames sort chronologically as plain strings
  // because Date.now() produces a fixed-width (13-digit) prefix for a very
  // long time yet - no need to parse timestamps back out to compare them.
  async latest(targetPath: string): Promise<string | null> {
    const suffix = `-${this.key(targetPath)}`;
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const matches = entries.filter((f) => f.endsWith(suffix)).sort().reverse();
    if (matches.length === 0) return null;
    return readFile(path.join(this.root, matches[0]), "utf-8");
  }
}

export const backupStore = new BackupStore();

// Restores `targetPath` from its most recent backup, if any, returning
// whether one was found and restored. Shared by every entry point's
// CommandContext.rollback (Phase 31) - unlike switchProvider (which needs
// a different "current agent" per entry point), there's nothing
// entry-point-specific about restoring a file, so this is one function
// passed everywhere rather than three near-identical closures.
export async function restoreLatest(targetPath: string): Promise<boolean> {
  const content = await backupStore.latest(targetPath);
  if (content === null) return false;
  await writeFile(targetPath, content, "utf-8");
  return true;
}

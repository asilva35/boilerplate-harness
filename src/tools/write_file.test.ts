import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupStore } from "../backup/store.js";
import { writeFileTool } from "./write_file.js";

const REAL_BACKUPS_ROOT = path.join(".harness", "backups");

// write_file.ts uses backupStore's process-wide singleton (same reasoning
// as debug.ts's ring buffer - see backup/store.ts), so exercising it for
// real here means real backup files land in this project's actual
// .harness/backups/, not some isolated fixture. Each temp dir's path is
// unique (mkdtemp), so nothing real ever collides - but leaving those
// files behind after the test run would still be clutter, so this sweeps
// up anything whose filename contains this test's own temp dir path.
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "write-file-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    try {
      const marker = encodeURIComponent(dir);
      const entries = await readdir(REAL_BACKUPS_ROOT);
      await Promise.all(
        entries.filter((f) => f.includes(marker)).map((f) => unlink(path.join(REAL_BACKUPS_ROOT, f))),
      );
    } catch {
      // .harness/backups/ not created yet, or already clean - nothing to sweep
    }
  }
}

test("overwriting an existing file with different content backs it up first", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "a.txt");
    await writeFileTool.execute({ path: file, content: "version 1" });

    const result = await writeFileTool.execute({ path: file, content: "version 2" });

    assert.equal(result.isError, false);
    assert.match(result.result, /backup saved/);
    assert.equal(await backupStore.latest(file), "version 1");
    assert.equal(await readFile(file, "utf-8"), "version 2");
  });
});

test("a brand-new file isn't backed up - there's nothing to restore to", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "new.txt");

    const result = await writeFileTool.execute({ path: file, content: "hello" });

    assert.equal(result.isError, false);
    assert.doesNotMatch(result.result, /backup saved/);
    assert.equal(await backupStore.latest(file), null);
  });
});

test("rewriting a file with identical content skips the backup - nothing actually changed", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "same.txt");
    await writeFileTool.execute({ path: file, content: "unchanged" });

    const result = await writeFileTool.execute({ path: file, content: "unchanged" });

    assert.equal(result.isError, false);
    assert.doesNotMatch(result.result, /backup saved/);
    assert.equal(await backupStore.latest(file), null);
  });
});

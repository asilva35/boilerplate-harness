import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BackupStore } from "./store.js";

async function withRoot(fn: (root: string, store: BackupStore) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "backup-store-test-"));
  try {
    await fn(root, new BackupStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("latest(): null when nothing was ever saved for a path (root doesn't even exist yet)", async () => {
  await withRoot(async (_root, store) => {
    assert.equal(await store.latest("/some/file.ts"), null);
  });
});

test("save()/latest(): round-trips the exact content that was saved", async () => {
  await withRoot(async (_root, store) => {
    await store.save("/some/file.ts", "old content");
    assert.equal(await store.latest("/some/file.ts"), "old content");
  });
});

test("latest(): returns the most recent of several backups for the same path, not the first", async () => {
  await withRoot(async (_root, store) => {
    await store.save("/some/file.ts", "version 1");
    await new Promise((r) => setTimeout(r, 2)); // Date.now() resolution
    await store.save("/some/file.ts", "version 2");
    await new Promise((r) => setTimeout(r, 2));
    await store.save("/some/file.ts", "version 3");

    assert.equal(await store.latest("/some/file.ts"), "version 3");
  });
});

test("save()/latest(): two different paths never collide, even with the same basename", async () => {
  await withRoot(async (_root, store) => {
    await store.save("/a/file.ts", "from a");
    await store.save("/b/file.ts", "from b");

    assert.equal(await store.latest("/a/file.ts"), "from a");
    assert.equal(await store.latest("/b/file.ts"), "from b");
  });
});

test("save()/latest(): relative and equivalent-but-differently-spelled paths resolve to the same entry", async () => {
  await withRoot(async (_root, store) => {
    await store.save("src/foo.ts", "relative save");
    assert.equal(await store.latest(path.resolve("src/foo.ts")), "relative save");
    assert.equal(await store.latest("./src/foo.ts"), "relative save");
  });
});

test("save(): a path-traversal-shaped target never escapes root - only ever writes flat filenames inside it", async () => {
  await withRoot(async (root, store) => {
    await store.save("../../etc/passwd", "not actually passwd");
    const entries = await readdir(root);
    assert.equal(entries.length, 1);
    assert.ok(!entries[0].includes("/")); // a flat filename, not a nested path
  });
});

test("latest(): a stray, unrelated file in the backups dir doesn't get mistaken for a match", async () => {
  await withRoot(async (root, store) => {
    await store.save("/some/file.ts", "the real backup");
    await writeFile(path.join(root, "not-a-backup.txt"), "junk");

    assert.equal(await store.latest("/some/file.ts"), "the real backup");
  });
});

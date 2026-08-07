import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionFiles } from "./session-files.js";
import { MemoryKind } from "./types.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "session-files-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a session with no save() calls never creates a session file or index entry", async () => {
  await withTempDir(async (dir) => {
    const store = await SessionFiles.open(dir);
    await store.close();

    assert.equal(await store.preamble(), "");
    await assert.rejects(readFile(path.join(dir, "index.json")));
  });
});

test("close() flushes the draft to a markdown file and an index.json entry", async () => {
  await withTempDir(async (dir) => {
    const store = await SessionFiles.open(dir);
    await store.save({ time: new Date(), kind: MemoryKind.Fact, content: "the config lives at app.yaml", tags: [] });
    await store.save({
      time: new Date(),
      kind: MemoryKind.SessionSummary,
      content: "discussed config layout",
      tags: ["config"],
    });
    await store.close();

    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf-8"));
    assert.equal(index.sessions.length, 1);
    assert.equal(index.sessions[0].summary, "discussed config layout");
    assert.deepEqual(index.sessions[0].tags, ["config"]);

    const sessionBody = await readFile(path.join(dir, index.sessions[0].path), "utf-8");
    assert.match(sessionBody, /## Summary/);
    assert.match(sessionBody, /discussed config layout/);
    assert.match(sessionBody, /## Facts/);
    assert.match(sessionBody, /the config lives at app.yaml/);
  });
});

test("close() is idempotent - a second call is a no-op", async () => {
  await withTempDir(async (dir) => {
    const store = await SessionFiles.open(dir);
    await store.save({ time: new Date(), kind: MemoryKind.Fact, content: "one fact", tags: [] });
    await store.close();
    await store.close(); // should not throw, should not add a second index entry

    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf-8"));
    assert.equal(index.sessions.length, 1);
  });
});

test("preamble is empty with no prior sessions, and lists the most recent ones once there are some", async () => {
  await withTempDir(async (dir) => {
    let store = await SessionFiles.open(dir);
    assert.equal(await store.preamble(), "");

    await store.save({
      time: new Date(),
      kind: MemoryKind.SessionSummary,
      content: "set up the project",
      tags: ["setup"],
    });
    await store.close();

    // Reopen - preamble must survive a process restart, reading from disk.
    store = await SessionFiles.open(dir);
    const preamble = await store.preamble();
    assert.match(preamble, /# Recent sessions/);
    assert.match(preamble, /set up the project/);
    assert.match(preamble, /\(setup\)/);
  });
});

test("recall matches by summary or tag substring, case-insensitively, most recent first", async () => {
  await withTempDir(async (dir) => {
    let store = await SessionFiles.open(dir);
    await store.save({ time: new Date(), kind: MemoryKind.SessionSummary, content: "worked on auth", tags: ["auth"] });
    await store.close();

    store = await SessionFiles.open(dir);
    await store.save({
      time: new Date(),
      kind: MemoryKind.SessionSummary,
      content: "worked on billing",
      tags: ["billing"],
    });
    await store.close();

    store = await SessionFiles.open(dir);
    const authMatches = await store.recall("AUTH", 5);
    assert.equal(authMatches.length, 1);
    assert.match(authMatches[0].content, /worked on auth/);

    const all = await store.recall("", 5);
    assert.equal(all.length, 2);
    assert.match(all[0].content, /billing/); // most recent first

    const none = await store.recall("nonexistent", 5);
    assert.equal(none.length, 0);
  });
});

test("recall respects the limit", async () => {
  await withTempDir(async (dir) => {
    let store = await SessionFiles.open(dir);
    for (let i = 0; i < 3; i++) {
      await store.save({ time: new Date(), kind: MemoryKind.SessionSummary, content: `session ${i}`, tags: [] });
      await store.close();
      store = await SessionFiles.open(dir);
    }

    const results = await store.recall("", 2);
    assert.equal(results.length, 2);
  });
});

test("a session file deleted from disk gets pruned from the index on next open", async () => {
  await withTempDir(async (dir) => {
    let store = await SessionFiles.open(dir);
    await store.save({ time: new Date(), kind: MemoryKind.SessionSummary, content: "temp session", tags: [] });
    await store.close();

    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf-8"));
    await unlink(path.join(dir, index.sessions[0].path));

    store = await SessionFiles.open(dir);
    assert.equal(await store.preamble(), "");
  });
});

test("entries without a session-summary use a placeholder summary and group facts/decisions/preferences into sections", async () => {
  await withTempDir(async (dir) => {
    const store = await SessionFiles.open(dir);
    await store.save({ time: new Date(), kind: MemoryKind.Fact, content: "fact one", tags: [] });
    await store.save({ time: new Date(), kind: MemoryKind.Decision, content: "decision one", tags: [] });
    await store.save({ time: new Date(), kind: MemoryKind.Preference, content: "preference one", tags: [] });
    await store.save({ time: new Date(), kind: "custom-kind", content: "an odd entry", tags: [] });
    await store.close();

    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf-8"));
    assert.equal(index.sessions[0].summary, "(no summary)");

    const body = await readFile(path.join(dir, index.sessions[0].path), "utf-8");
    assert.match(body, /## Facts\n\n- fact one/);
    assert.match(body, /## Decisions\n\n- decision one/);
    assert.match(body, /## Preferences\n\n- preference one/);
    assert.match(body, /## Notes\n\n- \(custom-kind\) an odd entry/);
  });
});

test("multiple session-summary entries (Phase 20: several conversations closing in one process) all survive, not just the last", async () => {
  await withTempDir(async (dir) => {
    const store = await SessionFiles.open(dir);
    await store.save({ time: new Date(), kind: MemoryKind.SessionSummary, content: "sess-A: discussed auth", tags: ["auth"] });
    await store.save({ time: new Date(), kind: MemoryKind.SessionSummary, content: "sess-B: discussed billing", tags: ["billing"] });
    await store.close();

    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf-8"));
    assert.match(index.sessions[0].summary, /sess-A: discussed auth/);
    assert.match(index.sessions[0].summary, /sess-B: discussed billing/);
    assert.deepEqual(index.sessions[0].tags.sort(), ["auth", "billing"]);

    const body = await readFile(path.join(dir, index.sessions[0].path), "utf-8");
    assert.match(body, /## Summary\n\n- sess-A: discussed auth\n- sess-B: discussed billing/);
  });
});

test("a malformed index.json is a real error, not silently swallowed", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "index.json"), "not json", "utf-8");
    await assert.rejects(() => SessionFiles.open(dir));
  });
});

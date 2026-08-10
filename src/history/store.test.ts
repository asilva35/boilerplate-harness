import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError } from "../errors.js";
import type { Message } from "../provider/types.js";
import { ChatHistoryStore } from "./store.js";

async function withStore(fn: (store: ChatHistoryStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "chat-history-test-"));
  try {
    const store = await ChatHistoryStore.open(root);
    await fn(store, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

test("upsert: an empty messages array is a no-op - nothing shows up in list()", async () => {
  await withStore(async (store) => {
    await store.upsert({ id: "abc123", userId: "local", role: "admin", profile: "default", messages: [] });
    assert.deepEqual(store.list(), []);
  });
});

test("upsert: an unsafe id (path traversal attempt) is a silent no-op, never written to disk", async () => {
  await withStore(async (store) => {
    await store.upsert({
      id: "../../etc/passwd",
      userId: "local",
      role: "admin",
      profile: "default",
      messages: [userText("hi")],
    });
    assert.deepEqual(store.list(), []);
    assert.equal(await store.get("../../etc/passwd"), null);
  });
});

test("upsert: first save picks a title from the first user text block, truncated", async () => {
  await withStore(async (store) => {
    const long = "a".repeat(100);
    await store.upsert({ id: "sess-1", userId: "local", role: "admin", profile: "default", messages: [userText(long)] });
    const [summary] = store.list();
    assert.equal(summary.title.length, 61); // 60 chars + ellipsis
    assert.ok(summary.title.endsWith("…"));
  });
});

test("upsert: falls back to \"New chat\" when there's no user text block yet", async () => {
  await withStore(async (store) => {
    const messages: Message[] = [{ role: "assistant", content: [{ type: "text", text: "hello" }] }];
    await store.upsert({ id: "sess-1", userId: "local", role: "admin", profile: "default", messages });
    assert.equal(store.list()[0].title, "New chat");
  });
});

test("upsert: a later call preserves the title/pinned flag set by update(), doesn't reset it", async () => {
  await withStore(async (store) => {
    await store.upsert({ id: "sess-1", userId: "local", role: "admin", profile: "default", messages: [userText("hi")] });
    await store.update("sess-1", { title: "Renamed", pinned: true });

    await store.upsert({
      id: "sess-1",
      userId: "local",
      role: "admin",
      profile: "default",
      messages: [userText("hi"), userText("second message")],
    });

    const summary = store.list()[0];
    assert.equal(summary.title, "Renamed");
    assert.equal(summary.pinned, true);
    assert.equal(summary.messageCount, 2);
  });
});

test("list(): pinned chats sort first, then most-recently-updated within each group", async () => {
  await withStore(async (store) => {
    await store.upsert({ id: "old", userId: "local", role: "admin", profile: "default", messages: [userText("old")] });
    await store.upsert({ id: "new", userId: "local", role: "admin", profile: "default", messages: [userText("new")] });
    await store.update("old", { pinned: true });

    const ids = store.list().map((s) => s.id);
    assert.deepEqual(ids, ["old", "new"]);
  });
});

test("get(): returns the full record (including messages) for a known id, null for an unknown one", async () => {
  await withStore(async (store) => {
    await store.upsert({ id: "sess-1", userId: "local", role: "admin", profile: "default", messages: [userText("hi")] });
    const record = await store.get("sess-1");
    assert.equal(record?.messages.length, 1);
    assert.equal(await store.get("nope"), null);
  });
});

test("get(): an unsafe id returns null rather than throwing or touching the filesystem", async () => {
  await withStore(async (store) => {
    assert.equal(await store.get("../../etc/passwd"), null);
  });
});

test("update(): throws ConfigError for an id this store has never saved", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.update("nope", { title: "x" }), ConfigError);
  });
});

test("update(): rename/pin also lands in the on-disk record, not just the index", async () => {
  await withStore(async (store) => {
    await store.upsert({ id: "sess-1", userId: "local", role: "admin", profile: "default", messages: [userText("hi")] });
    await store.update("sess-1", { title: "Renamed" });

    const record = await store.get("sess-1");
    assert.equal(record?.title, "Renamed");
  });
});

test("open(): a fresh store re-reads a previously flushed index.json - survives a restart", async () => {
  await withStore(async (_store, root) => {
    const first = await ChatHistoryStore.open(root);
    await first.upsert({ id: "sess-1", userId: "local", role: "admin", profile: "default", messages: [userText("hi")] });

    const second = await ChatHistoryStore.open(root);
    assert.equal(second.list().length, 1);
    assert.equal((await second.get("sess-1"))?.messages.length, 1);
  });
});

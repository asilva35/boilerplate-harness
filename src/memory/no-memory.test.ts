import { test } from "node:test";
import assert from "node:assert/strict";
import { NoMemory } from "./no-memory.js";
import { MemoryKind } from "./types.js";

test("save() is a no-op that never throws", async () => {
  const store = new NoMemory();
  await store.save({ time: new Date(), kind: MemoryKind.Fact, content: "anything", tags: [] });
});

test("recall() always returns an empty list", async () => {
  const store = new NoMemory();
  assert.deepEqual(await store.recall("anything", 5), []);
});

test("preamble() is always an empty string", async () => {
  const store = new NoMemory();
  assert.equal(await store.preamble(), "");
});

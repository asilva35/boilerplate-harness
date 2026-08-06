import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeSession } from "./index.js";
import type { Entry, MemoryStore } from "./types.js";
import { MockProvider } from "../provider/mock.js";
import type { Message } from "../provider/types.js";

class FakeStore implements MemoryStore {
  readonly saved: Entry[] = [];
  async save(entry: Entry): Promise<void> {
    this.saved.push(entry);
  }
  async recall(): Promise<Entry[]> {
    return [];
  }
  async preamble(): Promise<string> {
    return "";
  }
}

test("skips summarization entirely for an empty conversation, but still closes", async () => {
  const store = new FakeStore();
  let closed = false;
  const provider = new MockProvider([]); // would throw if send() were called

  await finalizeSession(provider, [], { store, close: async () => void (closed = true) });

  assert.equal(store.saved.length, 0);
  assert.equal(closed, true);
});

test("summarizes and saves a session-summary entry, then closes", async () => {
  const store = new FakeStore();
  let closed = false;
  const provider = new MockProvider([
    { content: [{ type: "text", text: "did some work\n\nTAGS: work" }], stopReason: "end_turn" },
  ]);
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];

  await finalizeSession(provider, messages, { store, close: async () => void (closed = true) });

  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0].content, "did some work");
  assert.deepEqual(store.saved[0].tags, ["work"]);
  assert.equal(closed, true);
});

test("a failure while saving or closing never throws - shutdown must not hang on this", async () => {
  const store: MemoryStore = {
    save: async () => {
      throw new Error("disk full");
    },
    recall: async () => [],
    preamble: async () => "",
  };
  const provider = new MockProvider([{ content: [{ type: "text", text: "x\n\nTAGS: x" }], stopReason: "end_turn" }]);
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];

  await finalizeSession(provider, messages, { store, close: async () => {} }); // should not reject
});

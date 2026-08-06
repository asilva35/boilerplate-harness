import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry, MemoryStore } from "../memory/types.js";
import { MemoryKind } from "../memory/types.js";
import { rememberTool } from "./remember.js";

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

test("saves the given content, defaulting kind to fact and tags to an empty array", async () => {
  const store = new FakeStore();
  const tool = rememberTool(store);

  const result = await tool.execute({ content: "the API key rotates weekly" });

  assert.deepEqual(result, { result: "remembered.", isError: false });
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0].content, "the API key rotates weekly");
  assert.equal(store.saved[0].kind, MemoryKind.Fact);
  assert.deepEqual(store.saved[0].tags, []);
});

test("passes through an explicit kind and tags", async () => {
  const store = new FakeStore();
  const tool = rememberTool(store);

  await tool.execute({ content: "use tabs, not spaces", kind: MemoryKind.Preference, tags: ["style", "editor"] });

  assert.equal(store.saved[0].kind, MemoryKind.Preference);
  assert.deepEqual(store.saved[0].tags, ["style", "editor"]);
});

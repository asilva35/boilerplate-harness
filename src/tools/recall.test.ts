import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry, MemoryStore } from "../memory/types.js";
import { MemoryKind } from "../memory/types.js";
import { recallTool } from "./recall.js";

class FakeStore implements MemoryStore {
  constructor(private readonly entries: Entry[] = []) {}
  lastQuery: string | undefined;
  lastLimit: number | undefined;
  async save(): Promise<void> {}
  async recall(query: string, limit: number): Promise<Entry[]> {
    this.lastQuery = query;
    this.lastLimit = limit;
    return this.entries;
  }
  async preamble(): Promise<string> {
    return "";
  }
}

test("reports 'no matches' when the store returns nothing", async () => {
  const tool = recallTool(new FakeStore([]));

  const result = await tool.execute({ query: "nonexistent" });

  assert.deepEqual(result, { result: "no matches.", isError: false });
});

test("formats matches with date, content, and tags", async () => {
  const store = new FakeStore([
    {
      time: new Date("2026-01-15T10:00:00Z"),
      kind: MemoryKind.SessionSummary,
      content: "[sessions/2026-01-15.md] worked on the config loader",
      tags: ["config", "loader"],
    },
  ]);
  const tool = recallTool(store);

  const result = await tool.execute({ query: "config" });

  assert.equal(result.isError, false);
  assert.match(result.result, /1 match\(es\) for "config":/);
  assert.match(result.result, /2026-01-15/);
  assert.match(result.result, /worked on the config loader/);
  assert.match(result.result, /\[config, loader\]/);
});

test("defaults limit to 5 when not given", async () => {
  const store = new FakeStore([]);
  const tool = recallTool(store);

  await tool.execute({ query: "anything" });

  assert.equal(store.lastLimit, 5);
});

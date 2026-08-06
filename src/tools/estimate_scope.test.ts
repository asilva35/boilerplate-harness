import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateScopeTool } from "./estimate_scope.js";

test("a single file is judged local, no delegation suggested", async () => {
  const result = await estimateScopeTool.execute({ description: "fix a typo", files: ["src/foo.ts"] });

  assert.equal(result.isError, false);
  assert.match(result.result, /local/);
  assert.doesNotMatch(result.result, /delegate_research/);
});

test("zero files (a pure discussion, nothing to touch) is also local", async () => {
  const result = await estimateScopeTool.execute({ description: "explain how X works", files: [] });

  assert.match(result.result, /local/);
});

test("a handful of files suggests delegating first", async () => {
  const result = await estimateScopeTool.execute({
    description: "rename a flag across the codebase",
    files: ["a.ts", "b.ts", "c.ts"],
  });

  assert.match(result.result, /touches 3 files/);
  assert.match(result.result, /delegate_research/);
});

test("many files strongly recommends delegating and mentions clarifying if still unclear", async () => {
  const result = await estimateScopeTool.execute({
    description: "refactor the whole module",
    files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
  });

  assert.match(result.result, /touches 6 files/);
  assert.match(result.result, /strongly recommended/);
  assert.match(result.result, /clarifying question/);
});

test("duplicate file paths are deduplicated before counting", async () => {
  const result = await estimateScopeTool.execute({
    description: "read the same file twice",
    files: ["a.ts", "a.ts"],
  });

  assert.match(result.result, /local/); // 1 unique file, not 2
});

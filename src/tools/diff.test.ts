import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildWriteDiff } from "./diff.js";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "diff-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("returns '' for malformed JSON", () => {
  assert.equal(buildWriteDiff("not json"), "");
});

test("returns '' when path or content is missing", () => {
  assert.equal(buildWriteDiff(JSON.stringify({ path: "a.txt" })), "");
  assert.equal(buildWriteDiff(JSON.stringify({ content: "hi" })), "");
});

test("shows every line as added for a file that doesn't exist yet", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "new.txt");
    const diff = buildWriteDiff(JSON.stringify({ path: target, content: "hello\nworld\n" }));
    assert.match(diff, /\+hello/);
    assert.match(diff, /\+world/);
    assert.doesNotMatch(diff, /^-(?!--)/m); // no removed lines, only the "---" header
  });
});

test("shows a unified diff against the current contents of an existing file", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "existing.txt");
    writeFileSync(target, "hello\nworld\n", "utf-8");
    const diff = buildWriteDiff(JSON.stringify({ path: target, content: "hello\nthere\n" }));
    assert.match(diff, /-world/);
    assert.match(diff, /\+there/);
  });
});

test("flags identical content instead of showing an empty diff", () => {
  withTempDir((dir) => {
    const target = path.join(dir, "same.txt");
    writeFileSync(target, "hello\n", "utf-8");
    const diff = buildWriteDiff(JSON.stringify({ path: target, content: "hello\n" }));
    assert.match(diff, /identical/);
  });
});

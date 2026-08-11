import { test } from "node:test";
import assert from "node:assert/strict";
import { cyan, dim, green, red } from "./styles.js";
import { highlightDiff } from "./highlight.js";

test("highlightDiff: colors an added line green", () => {
  assert.equal(highlightDiff("+new line"), green("+new line"));
});

test("highlightDiff: colors a removed line red", () => {
  assert.equal(highlightDiff("-old line"), red("-old line"));
});

test("highlightDiff: colors a hunk header cyan", () => {
  assert.equal(highlightDiff("@@ -1,3 +1,3 @@"), cyan("@@ -1,3 +1,3 @@"));
});

test("highlightDiff: dims the file header lines, not green/red like a plain +/- line", () => {
  assert.equal(highlightDiff("--- a/foo.ts (current)"), dim("--- a/foo.ts (current)"));
  assert.equal(highlightDiff("+++ a/foo.ts (proposed)"), dim("+++ a/foo.ts (proposed)"));
});

test("highlightDiff: leaves a plain context line untouched", () => {
  assert.equal(highlightDiff(" unchanged context line"), " unchanged context line");
});

test("highlightDiff: colors each line of a full multi-line diff independently", () => {
  const diff = ["--- a (current)", "+++ a (proposed)", "@@ -1,2 +1,2 @@", " same", "-removed", "+added"].join("\n");

  const result = highlightDiff(diff);
  const lines = result.split("\n");

  assert.equal(lines[0], dim("--- a (current)"));
  assert.equal(lines[1], dim("+++ a (proposed)"));
  assert.equal(lines[2], cyan("@@ -1,2 +1,2 @@"));
  assert.equal(lines[3], " same");
  assert.equal(lines[4], red("-removed"));
  assert.equal(lines[5], green("+added"));
});

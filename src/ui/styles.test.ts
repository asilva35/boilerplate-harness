import { test } from "node:test";
import assert from "node:assert/strict";
import { bold, cyan, dim, green, red, yellow } from "./styles.js";

const RESET = "\x1b[0m";

test("each color helper wraps its input with the matching ANSI code and a trailing reset", () => {
  assert.equal(bold("x"), `\x1b[1mx${RESET}`);
  assert.equal(dim("x"), `\x1b[2mx${RESET}`);
  assert.equal(cyan("x"), `\x1b[36mx${RESET}`);
  assert.equal(green("x"), `\x1b[32mx${RESET}`);
  assert.equal(red("x"), `\x1b[31mx${RESET}`);
  assert.equal(yellow("x"), `\x1b[33mx${RESET}`);
});

test("an empty string still gets wrapped, not skipped", () => {
  assert.equal(cyan(""), `\x1b[36m${RESET}`);
});

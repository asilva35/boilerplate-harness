// Equivalent to internal/agent/diff.go (buildWriteDiff), using go-difflib
// there and the `diff` npm package here. Called from every entry point's
// confirm callback so the approval prompt shows what write_file would
// actually change on disk, instead of the raw JSON input.

import { existsSync, readFileSync } from "node:fs";
import { createTwoFilesPatch } from "diff";

// Returns "" when rawInput isn't a well-formed write_file call — the
// caller falls back to showing the plain input, same contract as Go's
// buildWriteDiff.
export function buildWriteDiff(rawInput: string): string {
  let input: { path?: unknown; content?: unknown };
  try {
    input = JSON.parse(rawInput);
  } catch {
    return "";
  }
  if (typeof input.path !== "string" || typeof input.content !== "string") return "";

  // A nonexistent target reads as "", which createTwoFilesPatch already
  // renders as a diff where every line is added — no separate "new file"
  // code path needed, unlike the hand-rolled synthesizeNewFileDiff in Go.
  const existing = existsSync(input.path) ? readFileSync(input.path, "utf-8") : "";

  const patch = createTwoFilesPatch(
    `${input.path} (current)`,
    `${input.path} (proposed)`,
    existing,
    input.content,
    undefined,
    undefined,
    { context: 3 },
  );

  // With no differences, createTwoFilesPatch still returns the "---"/"+++"
  // header with no hunks — not useful to show as "the diff to approve".
  if (!patch.includes("@@")) {
    return "(no changes: proposed content is identical to current file)\n";
  }
  return patch;
}

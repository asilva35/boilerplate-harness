// Phase 33: equivalent to internal/ui/highlight.go, scoped down to the one
// payload this TUI actually shows a human - a unified diff (write_file's
// approval prompt, buildWriteDiff from Phase 11). Go's version also
// color-detects JSON for its debug modal; nothing in this TUI renders raw
// JSON to a human in a way that's worth a second detection path, so this
// stays diff-only rather than porting a generic "detect the language"
// dispatcher for a case that doesn't exist here.
//
// No highlighting library (the guide names cli-highlight/shiki as
// candidates, evaluating dependency cost vs. benefit) - a unified diff's
// structure is four line prefixes, not a real language grammar; pulling in
// even a lightweight generic highlighter for that is more dependency than
// the problem needs.

import { cyan, dim, green, red } from "./styles.js";

export function highlightDiff(diffText: string): string {
  return diffText
    .split("\n")
    .map((line) => {
      // Order matters: "+++"/"---" (file headers) must be checked before
      // the single-character "+"/"-" (added/removed lines) they'd
      // otherwise also match.
      if (line.startsWith("+++") || line.startsWith("---")) return dim(line);
      if (line.startsWith("@@")) return cyan(line);
      if (line.startsWith("+")) return green(line);
      if (line.startsWith("-")) return red(line);
      return line;
    })
    .join("\n");
}

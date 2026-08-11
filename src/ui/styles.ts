// Phase 33: small ANSI color helpers for the TUI's startup banner and diff
// highlighting - mirrors internal/ui/styles.go's minimal vocabulary (bold,
// cyan, dim) rather than pulling in a color library for a handful of
// wrap-in-escape-codes functions. Plain strings, not Ink <Text> - these are
// used from console.log calls that run both before the Ink app mounts
// (tui.tsx's startup banner) and from inside it (App.tsx's approval
// prompt, which Ink's own console.log patch forwards to the scrollback
// unchanged either way).

const RESET = "\x1b[0m";

function wrap(code: string, s: string): string {
  return `${code}${s}${RESET}`;
}

export const bold = (s: string): string => wrap("\x1b[1m", s);
export const dim = (s: string): string => wrap("\x1b[2m", s);
export const cyan = (s: string): string => wrap("\x1b[36m", s);
export const green = (s: string): string => wrap("\x1b[32m", s);
export const red = (s: string): string => wrap("\x1b[31m", s);
export const yellow = (s: string): string => wrap("\x1b[33m", s);

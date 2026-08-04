// Shared error-reporting helper for all three entry points (index.ts,
// tui.tsx, server.ts). Distinguishes expected, user-actionable startup
// problems from real bugs: a ConfigError (e.g. a missing API key) gets a
// clean one-line message, while anything else keeps its full stack trace —
// which is exactly what you want while debugging an actual crash.

export class ConfigError extends Error {}

export function reportFatal(err: unknown): never {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error("Fatal error:", err);
  }
  process.exit(1);
}

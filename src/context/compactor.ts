// Equivalent to internal/compact/*.go: a compaction strategy is anything
// that takes the message history and returns a shorter one. The system
// prompt never lives in `messages[]` (it goes separately, in
// config.systemPrompt), so "keeping it" is free — compaction only touches
// the array of user/assistant turns.

import type { HarnessConfig } from "../harness-config.js";
import type { Message } from "../provider/types.js";

export interface CompactionStrategy {
  compact(messages: Message[]): Message[];
}

// A ~4-characters-per-token heuristic — the same starting point the Go
// README suggests for its TokenBudget exercise ("Start with a byte-count
// approximation; later swap in a real count_tokens call").
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "text") chars += b.text.length;
      else if (b.type === "tool_use") chars += b.toolName.length + b.toolInput.length;
      else chars += b.toolResult.length;
    }
  }
  return Math.ceil(chars / 4);
}

// Equivalent to SafeSplitPoint in internal/compact/strategy.go: walks
// backwards from `desired` until it finds a "clean" cut point — right
// before a user message that is NOT purely tool_results. Cutting anywhere
// else would leave a tool_use without its matching tool_result, and the
// API would respond with a 400. Returns 0 if there's no safe boundary
// (= don't touch anything).
export function safeSplitPoint(messages: Message[], desired: number): number {
  if (desired <= 0) return 0;
  if (desired >= messages.length) return messages.length;
  for (let i = desired; i > 0; i--) {
    if (messages[i].role === "user" && !hasToolResult(messages[i])) return i;
  }
  return 0;
}

function hasToolResult(m: Message): boolean {
  return m.content.some((b) => b.type === "tool_result");
}

// Default — never modifies the messages.
export class NoCompaction implements CompactionStrategy {
  compact(messages: Message[]): Message[] {
    return messages;
  }
}

// Keeps the last `keepLast` messages. If `tokenThreshold` is passed, it
// also only acts once the estimated history exceeds that threshold — even
// with more than `keepLast` messages, it won't trim until the history
// "weighs" enough. With tokenThreshold=0 it compacts as soon as keepLast is
// exceeded in message count (identical behavior to Go's SlidingWindow).
export class SlidingWindow implements CompactionStrategy {
  constructor(
    private readonly keepLast: number,
    private readonly tokenThreshold = 0,
  ) {}

  compact(messages: Message[]): Message[] {
    if (messages.length <= this.keepLast) return messages;
    if (this.tokenThreshold > 0 && estimateTokens(messages) < this.tokenThreshold) {
      return messages;
    }
    const split = safeSplitPoint(messages, messages.length - this.keepLast);
    return messages.slice(split);
  }
}

// Phase 8: builds the compactor an entry point should use from
// harness.config.json's "compaction" field, replacing what used to be a
// `new SlidingWindow(20, 4000)` hardcoded identically in all three entry
// points.
export function buildCompactor(cfg: HarnessConfig["compaction"]): CompactionStrategy {
  if (cfg.strategy === "none") return new NoCompaction();
  return new SlidingWindow(cfg.keepLast, cfg.tokenThreshold);
}

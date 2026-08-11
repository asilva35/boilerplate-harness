// Equivalent to internal/compact/*.go: a compaction strategy is anything
// that takes the message history and returns a shorter one. The system
// prompt never lives in `messages[]` (it goes separately, in
// config.systemPrompt), so "keeping it" is free — compaction only touches
// the array of user/assistant turns.

import type { HarnessConfig } from "../harness-config.js";
import type { Block, Message, Provider } from "../provider/types.js";

// Promise<Message[]> (not just Message[]) because Summarize below needs to
// call out to the provider - NoCompaction and SlidingWindow don't need to
// await anything internally, but still declare `async compact()` to
// satisfy the same interface every strategy is used through.
export interface CompactionStrategy {
  compact(messages: Message[]): Promise<Message[]>;
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
      else if (b.type === "tool_result") chars += b.toolResult.length;
      // Phase 29: an attached image's base64 payload is real context the
      // model actually pays for, so it counts toward the threshold too -
      // unlike renderTranscript() below, where the raw bytes would just
      // bloat the summarization prompt for no benefit.
      else chars += b.data.length;
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

// Equivalent to api.RenderTranscript in internal/api/types.go: a plain-text
// transcript fed into the summarization prompt below.
export function renderTranscript(messages: Message[]): string {
  let out = "";
  for (const m of messages) {
    out += `${m.role}: `;
    for (const b of m.content) {
      if (b.type === "text") out += b.text;
      else if (b.type === "tool_use") out += `[called ${b.toolName} with ${b.toolInput}]`;
      else if (b.type === "tool_result") out += `[tool result: ${b.toolResult}]`;
      // A placeholder, not the base64 payload - this feeds the Summarize
      // strategy's own request to the model, and dumping a whole image's
      // bytes into a "summarize this conversation" prompt would bloat that
      // call for no benefit (the model can't usefully act on the
      // placeholder text either way, since the actual image is gone once
      // this message gets compacted away).
      else out += `[image attached: ${b.mediaType}]`;
      out += "\n";
    }
  }
  return out;
}

// Default — never modifies the messages.
export class NoCompaction implements CompactionStrategy {
  async compact(messages: Message[]): Promise<Message[]> {
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

  async compact(messages: Message[]): Promise<Message[]> {
    if (messages.length <= this.keepLast) return messages;
    if (this.tokenThreshold > 0 && estimateTokens(messages) < this.tokenThreshold) {
      return messages;
    }
    const split = safeSplitPoint(messages, messages.length - this.keepLast);
    return messages.slice(split);
  }
}

const DEFAULT_SUMMARIZE_INSTRUCTIONS =
  "Summarize the following conversation concisely. Preserve facts, decisions, file paths, " +
  "code identifiers, and anything else needed to continue the conversation. Output the " +
  "summary directly with no preamble.";

// Equivalent to internal/compact/summarize.go: instead of mechanically
// trimming (SlidingWindow), asks the provider itself to summarize the
// older turns once `threshold` is reached, replacing them with a single
// synthetic message and leaving the most recent `keepRecent` untouched.
export class Summarize implements CompactionStrategy {
  constructor(
    private readonly provider: Provider,
    private readonly threshold: number,
    private readonly keepRecent: number,
    private readonly instructions = DEFAULT_SUMMARIZE_INSTRUCTIONS,
  ) {}

  async compact(messages: Message[]): Promise<Message[]> {
    if (messages.length < this.threshold) return messages;
    const split = safeSplitPoint(messages, messages.length - this.keepRecent);
    if (split === 0) return messages;

    const old = messages.slice(0, split);
    const recent = messages.slice(split);
    const prompt = `${this.instructions}\n\n${renderTranscript(old)}`;

    // "" for the system prompt: the instructions are already in the user
    // turn above (`prompt`), and the root agent's own system prompt isn't
    // relevant to a one-off "summarize this transcript" call.
    const response = await this.provider.send([{ role: "user", content: [{ type: "text", text: prompt }] }], "");
    const summary = response.content.find((b): b is Extract<Block, { type: "text" }> => b.type === "text")?.text;
    if (!summary) return messages; // same "give up, leave history alone" fallback as Go's error path

    return [
      { role: "user", content: [{ type: "text", text: `[earlier conversation summary]\n${summary}` }] },
      ...recent,
    ];
  }
}

// Phase 8: builds the compactor an entry point should use from
// harness.config.json's "compaction" field, replacing what used to be a
// `new SlidingWindow(20, 4000)` hardcoded identically in all three entry
// points. Phase 13: takes the provider too, only used by "summarize".
export function buildCompactor(cfg: HarnessConfig["compaction"], provider: Provider): CompactionStrategy {
  if (cfg.strategy === "none") return new NoCompaction();
  if (cfg.strategy === "summarize") return new Summarize(provider, cfg.summarizeThreshold, cfg.keepLast);
  return new SlidingWindow(cfg.keepLast, cfg.tokenThreshold);
}

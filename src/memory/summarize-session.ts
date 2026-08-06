// Equivalent to summarizeSession/parseSummaryAndTags in main.go: at
// shutdown, asks the model itself to summarize the session so the *next*
// session starts knowing something. Best-effort - a failed call still
// lets the caller flush whatever draft entries exist (remember()'d facts,
// decisions, preferences), just with a placeholder summary instead of a
// real one, exactly like Go's fallback.

import { renderTranscript } from "../context/compactor.js";
import type { Block, Message, Provider } from "../provider/types.js";

const MAX_TRANSCRIPT_CHARS = 50_000;

const INSTRUCTIONS = `You are summarizing a coding-agent session for persistent memory used by future sessions.

Output format, exactly:

<one paragraph summarizing what was worked on, decided, learned, or left open>

TAGS: tag1, tag2, tag3

Use 3-5 single-word lowercase tags. Be concrete about technical topics covered (file names, package names, concepts). Skip pleasantries.

Transcript follows:

`;

export async function summarizeSession(
  provider: Provider,
  messages: Message[],
): Promise<{ summary: string; tags: string[] }> {
  let transcript = renderTranscript(messages);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[...truncated...]";
  }

  try {
    // "" system prompt: same reasoning as Summarize.compact() (Phase 13) -
    // the instructions are entirely in the user turn, and the root
    // agent's own system prompt isn't relevant to a one-off summary call.
    const response = await provider.send(
      [{ role: "user", content: [{ type: "text", text: INSTRUCTIONS + transcript }] }],
      "",
    );
    const text = response.content
      .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseSummaryAndTags(text);
  } catch (err) {
    return { summary: `(summarization failed: ${(err as Error).message})`, tags: [] };
  }
}

// Extracts a "<summary>\n\nTAGS: a, b, c" shape from the model's reply. If
// the TAGS line is missing, returns the full text as the summary and no
// tags - never throws, the summarizer is best-effort.
function parseSummaryAndTags(text: string): { summary: string; tags: string[] } {
  const idx = text.lastIndexOf("TAGS:");
  if (idx < 0) return { summary: text.trim(), tags: [] };

  const summary = text.slice(0, idx).trim();
  const tags = text
    .slice(idx + "TAGS:".length)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  return { summary, tags };
}

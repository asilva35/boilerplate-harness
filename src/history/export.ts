// Markdown rendering for GET /api/chats/:id/export?format=md (server.ts).
// The JSON half of that endpoint needs no helper - it's just
// JSON.stringify(record, null, 2) - so this file only covers the format
// that actually needs assembling.

import type { Block } from "../provider/types.js";
import type { ChatRecord } from "./types.js";

export function toMarkdown(record: ChatRecord): string {
  let out = `# ${record.title}\n\n`;
  out += `- id: ${record.id}\n`;
  out += `- user: ${record.userId} · role: ${record.role} · profile: ${record.profile}\n`;
  out += `- updated: ${record.updatedAt}\n\n`;
  out += "---\n";

  for (const message of record.messages) {
    out += `\n## ${message.role === "user" ? "User" : "Assistant"}\n\n`;
    out += message.content.map(blockToMarkdown).join("\n\n");
    out += "\n";
  }

  return out;
}

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "tool_use":
      return `\`\`\`\n[tool call] ${block.toolName}\n${block.toolInput}\n\`\`\``;
    case "tool_result":
      return `\`\`\`\n[tool result${block.isError ? " - error" : ""}]\n${block.toolResult}\n\`\`\``;
  }
}

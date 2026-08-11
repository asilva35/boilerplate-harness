// Phase 33: equivalent to internal/ui/banner.go, scaled down deliberately -
// this boilerplate isn't a fixed-brand product the way Go's original is
// (every deployment is meant to rename/reconfigure it via
// harness.config.json, Phase 8), so a giant ASCII wordmark would be the
// wrong kind of "polish" here. A small, tasteful header reads better on
// something that gets forked and renamed per project - closer to Go's own
// narrow-terminal fallback banner than its full animated wordmark.

import { bold, cyan, dim } from "./styles.js";

const RULE_WIDTH = 70;

export function bannerText(providerKind: string, model: string, toolNames: string[]): string {
  const rule = cyan("─".repeat(RULE_WIDTH));
  return (
    `${rule}\n` +
    `  ${bold(cyan("boilerplate-harness"))}\n` +
    `  ${dim(`${providerKind} · ${model}`)}\n` +
    `  ${dim(`tools: ${toolNames.join(", ")}`)}\n` +
    `${rule}\n\n` +
    `Type your message and press Enter, or /help for commands. Ctrl+D or /exit to quit.\n`
  );
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerText } from "./banner.js";

test("bannerText includes the provider/model and every tool name passed in", () => {
  const text = bannerText("openrouter", "anthropic/claude-sonnet-4.6", ["read_file", "bash"]);

  assert.match(text, /openrouter/);
  assert.match(text, /anthropic\/claude-sonnet-4\.6/);
  assert.match(text, /read_file, bash/);
  assert.match(text, /boilerplate-harness/);
});

test("bannerText still includes the startup hint line unchanged in meaning", () => {
  const text = bannerText("anthropic", "claude-sonnet-4-6", []);
  assert.match(text, /\/help for commands/);
  assert.match(text, /Ctrl\+D or \/exit to quit/);
});

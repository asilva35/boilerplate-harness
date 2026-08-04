// Phase 3: permission gate + bash tool. Equivalent to the console session
// startup + internal/agent + Confirm from main.go, without the Bubble Tea
// TUI (here the [y/N] prompt is plain text on the console).

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Agent } from "./agent.js";
import { createProvider } from "./provider/index.js";
import { ToolRegistry } from "./tools/registry.js";
import { bashTool } from "./tools/bash.js";
import { readFileTool } from "./tools/read_file.js";
import { writeFileTool } from "./tools/write_file.js";

async function main() {
  const provider = createProvider();

  const tools = new ToolRegistry();
  tools.register(readFileTool);
  tools.register(writeFileTool);
  tools.register(bashTool);

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const agent = new Agent({
    provider,
    tools,
    onToolCall: (name, rawInput) => console.log(`[tool] ${name} ${rawInput}`),
    onAssistantText: (text) => console.log(text),
    confirm: async (name, rawInput) => {
      const answer = await rl.question(`  approve "${name}" ${rawInput}? [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    },
  });

  console.log(`boilerplate-harness — model: ${provider.model}`);
  console.log(`tools: ${tools.definitions().map((t) => t.name).join(", ")}`);
  console.log("Type your message and press Enter. Ctrl+C to exit.\n");

  while (true) {
    let input: string;
    try {
      input = await rl.question("> ");
    } catch (err) {
      // Ctrl+D (EOF) closes the interface while question() is pending.
      if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") break;
      throw err;
    }
    if (!input.trim()) continue;

    await agent.send(input);
    console.log();
  }

  console.log("\nBye!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

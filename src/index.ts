// Phase 2: Agent Loop + basic tool calling (read_file, write_file).
// Equivalent to the console session startup + internal/agent from main.go.

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Agent } from "./agent.js";
import { createProvider } from "./provider/index.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read_file.js";
import { writeFileTool } from "./tools/write_file.js";

async function main() {
  const provider = createProvider();

  const tools = new ToolRegistry();
  tools.register(readFileTool);
  tools.register(writeFileTool);

  const agent = new Agent({
    provider,
    tools,
    onToolCall: (name, rawInput) => console.log(`[tool] ${name} ${rawInput}`),
    onAssistantText: (text) => console.log(text),
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });

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

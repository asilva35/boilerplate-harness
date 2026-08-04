// Phase 1: minimal REPL, no tools yet. Equivalent to the console session
// startup in main.go, without the agent loop or tool registry (that lands
// in Phase 2).

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createProvider } from "./provider/index.js";
import type { Message } from "./provider/types.js";

async function main() {
  const provider = createProvider();
  const messages: Message[] = [];
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log(`boilerplate-harness — model: ${provider.model}`);
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

    messages.push({ role: "user", content: input });

    const response = await provider.send(messages);
    messages.push({ role: "assistant", content: response.text });

    console.log(`\n${response.text}\n`);
  }

  console.log("\nBye!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

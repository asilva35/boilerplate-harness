// Phase 5: MCP integration. Equivalent to the console session startup +
// internal/agent + internal/compact + internal/mcp + commands.go from
// main.go, without the Bubble Tea TUI (the migration to Ink is an optional
// step, included alongside this one — see src/tui.tsx).

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { SlidingWindow } from "./context/compactor.js";
import { loadConfig, registerMCPServers } from "./mcp/register.js";
import type { MCPClient } from "./mcp/client.js";
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

  // mcp.json is optional (gitignored, like in Go) — its absence is not an
  // error, it simply means there are no remote tools to register.
  let mcpClients: MCPClient[] = [];
  const mcpConfig = await loadConfig("mcp.json");
  if (mcpConfig) {
    mcpClients = await registerMCPServers(mcpConfig, tools);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const agent = new Agent({
    provider,
    tools,
    // Trim as soon as we pass 20 messages, or sooner if the history already
    // weighs ~4000 estimated tokens — whichever comes first.
    compactor: new SlidingWindow(20, 4000),
    onToolCall: (name, rawInput) => console.log(`[tool] ${name} ${rawInput}`),
    onAssistantText: (text) => console.log(text),
    confirm: async (name, rawInput) => {
      const answer = await rl.question(`  approve "${name}" ${rawInput}? [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    },
  });

  console.log(`boilerplate-harness — model: ${provider.model}`);
  console.log(`tools: ${tools.definitions().map((t) => t.name).join(", ")}`);
  console.log("Type your message and press Enter, or /help for commands. Ctrl+C to exit.\n");

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

    if (runCommand(input, { agent })) {
      console.log();
      continue;
    }

    await agent.send(input);
    console.log();
  }

  await Promise.all(mcpClients.map((c) => c.close()));
  console.log("\nBye!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

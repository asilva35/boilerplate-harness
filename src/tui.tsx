// Phase 5 (optional): same session as src/index.ts (provider, tools, MCP,
// Agent) but with an Ink-based TUI instead of the plain console REPL.
// src/index.ts is kept intact on purpose — it's the "readable, no magic"
// version for understanding the harness; this is the polish layer on top.

import { render } from "ink";
import { Agent } from "./agent.js";
import { SlidingWindow } from "./context/compactor.js";
import { reportFatal } from "./errors.js";
import { loadConfig, registerMCPServers } from "./mcp/register.js";
import type { MCPClient } from "./mcp/client.js";
import { createProvider } from "./provider/index.js";
import { ToolRegistry } from "./tools/registry.js";
import { bashTool } from "./tools/bash.js";
import { readFileTool } from "./tools/read_file.js";
import { writeFileTool } from "./tools/write_file.js";
import { App } from "./ui/App.js";

async function main() {
  const provider = createProvider();

  const tools = new ToolRegistry();
  tools.register(readFileTool);
  tools.register(writeFileTool);
  tools.register(bashTool);

  let mcpClients: MCPClient[] = [];
  const mcpConfig = await loadConfig("mcp.json");
  if (mcpConfig) {
    mcpClients = await registerMCPServers(mcpConfig, tools);
  }

  // The real confirm is only wired up once App mounts (it needs React
  // state for the live [y/N] prompt). Until then, this bridge is the
  // default value; registerConfirm replaces it exactly once.
  let confirmBridge: (name: string, rawInput: string) => Promise<boolean> = async () => true;

  const agent = new Agent({
    provider,
    tools,
    compactor: new SlidingWindow(20, 4000),
    onToolCall: (name, rawInput) => console.log(`[tool] ${name} ${rawInput}`),
    onAssistantText: (text) => console.log(text),
    confirm: (name, rawInput) => confirmBridge(name, rawInput),
  });

  console.log(`boilerplate-harness — model: ${provider.model}`);
  console.log(`tools: ${tools.definitions().map((t) => t.name).join(", ")}`);
  console.log("Type your message and press Enter, or /help for commands. Ctrl+D or /exit to quit.\n");

  const { waitUntilExit } = render(
    <App
      agent={agent}
      registerConfirm={(fn) => {
        confirmBridge = fn;
      }}
    />,
  );

  await waitUntilExit();
  await Promise.all(mcpClients.map((c) => c.close()));
  console.log("\nBye!");
}

main().catch(reportFatal);

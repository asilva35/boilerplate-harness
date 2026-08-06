// Phase 5 (optional): same session as src/index.ts (provider, tools, MCP,
// Agent) but with an Ink-based TUI instead of the plain console REPL.
// src/index.ts is kept intact on purpose — it's the "readable, no magic"
// version for understanding the harness; this is the polish layer on top.

import { render } from "ink";
import { Agent } from "./agent.js";
import { buildCompactor } from "./context/compactor.js";
import { reportFatal } from "./errors.js";
import { harnessConfig } from "./harness-config.js";
import { loadConfig, registerMCPServers } from "./mcp/register.js";
import type { MCPClient } from "./mcp/client.js";
import { createProvider } from "./provider/index.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { ToolRegistry } from "./tools/registry.js";
import { App } from "./ui/App.js";

async function main() {
  const provider = createProvider();

  const tools = new ToolRegistry();
  registerCatalogTools(tools, harnessConfig.tools);

  let mcpClients: MCPClient[] = [];
  const mcpConfig = await loadConfig("mcp.json");
  if (mcpConfig) {
    mcpClients = await registerMCPServers(mcpConfig, tools);
  }

  // The real confirm is only wired up once App mounts (it needs React
  // state for the live [y/N] prompt). Until then, this bridge is the
  // default value; registerConfirm replaces it exactly once. Same pattern
  // for the two streaming bridges below - App owns the live-preview state,
  // so onTextDelta/onAssistantText just forward into it.
  let confirmBridge: (name: string, rawInput: string) => Promise<boolean> = async () => true;
  let textDeltaBridge: (chunk: string) => void = () => {};
  let streamResetBridge: () => void = () => {};

  const agent = new Agent({
    provider,
    tools,
    compactor: buildCompactor(harnessConfig.compaction),
    onToolCall: (name, rawInput) => console.log(`[tool] ${name} ${rawInput}`),
    onAssistantText: (text) => {
      console.log(text);
      streamResetBridge();
    },
    onTextDelta: (chunk) => textDeltaBridge(chunk),
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
      registerTextDelta={(fn) => {
        textDeltaBridge = fn;
      }}
      registerStreamReset={(fn) => {
        streamResetBridge = fn;
      }}
    />,
  );

  await waitUntilExit();
  await Promise.all(mcpClients.map((c) => c.close()));
  console.log("\nBye!");
}

main().catch(reportFatal);

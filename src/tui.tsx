// Phase 5 (optional): same session as src/index.ts (provider, tools, MCP,
// Agent) but with an Ink-based TUI instead of the plain console REPL.
// src/index.ts is kept intact on purpose — it's the "readable, no magic"
// version for understanding the harness; this is the polish layer on top.

import { render } from "ink";
import { Agent } from "./agent.js";
import { buildCompactor } from "./context/compactor.js";
import { reportFatal } from "./errors.js";
import { harnessConfig } from "./harness-config.js";
import { createMemoryStore, finalizeSession } from "./memory/index.js";
import { connectMCPServers, loadConfig, registerMCPTools } from "./mcp/register.js";
import { createProvider } from "./provider/index.js";
import type { Provider } from "./provider/types.js";
import { SkillRegistry } from "./skills/registry.js";
import { registerCatalogTools, refreshSubagentTools } from "./tools/catalog.js";
import { ToolRegistry } from "./tools/registry.js";
import { App } from "./ui/App.js";

async function main() {
  const provider = createProvider();

  const memorySession = await createMemoryStore();
  const systemPrompt = harnessConfig.systemPrompt + (await memorySession.store.preamble());
  const skillRegistry = await SkillRegistry.load();

  // Connected before registerCatalogTools() below (Phase 23) so a
  // subagent's tool pack (harnessConfig.subagents) can include an MCP
  // tool - it needs the servers already dialed to resolve one by name.
  const mcpConfig = await loadConfig("mcp.json");
  const connectedMCP = mcpConfig ? await connectMCPServers(mcpConfig) : [];

  const tools = new ToolRegistry();
  registerCatalogTools(
    tools,
    harnessConfig.tools,
    provider,
    memorySession.store,
    skillRegistry,
    harnessConfig.subagents,
    connectedMCP,
    harnessConfig.subagentModels,
  );
  registerMCPTools(tools, connectedMCP);

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
    systemPrompt,
    compactor: buildCompactor(harnessConfig.compaction, provider),
    onToolCall: (name, rawInput) => console.log(`[tool] ${name} ${rawInput}`),
    onAssistantText: (text) => {
      console.log(text);
      streamResetBridge();
    },
    onTextDelta: (chunk) => textDeltaBridge(chunk),
    onRiskFlag: (name, risk, next) => console.log(`  ⚠ [${name}] risk: ${risk}${next ? ` — next: ${next}` : ""}`),
    confirm: (name, rawInput) => confirmBridge(name, rawInput),
  });

  // Phase 25: backs "/provider" - swaps agent.provider to a whole new
  // backend and refreshes delegate_* subagent tools to use it (see
  // tools/catalog.ts's refreshSubagentTools for why that refresh matters).
  function switchProvider(name: string, model?: string): Provider {
    const newProvider = createProvider(name, model);
    agent.provider = newProvider;
    refreshSubagentTools(
      tools,
      newProvider,
      harnessConfig.subagents,
      skillRegistry,
      connectedMCP,
      harnessConfig.subagentModels,
    );
    return newProvider;
  }

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
      switchProvider={switchProvider}
    />,
  );

  await waitUntilExit();
  await Promise.all(connectedMCP.map((c) => c.client.close()));
  // agent.provider, not the outer `provider` - /provider may have swapped
  // it mid-session, and summarizing with a stale reference would silently
  // use the wrong backend/model.
  await finalizeSession(agent.provider, agent.getMessages(), memorySession);
  console.log("\nBye!");
}

main().catch(reportFatal);

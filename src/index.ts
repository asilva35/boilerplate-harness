// Phase 5: MCP integration. Equivalent to the console session startup +
// internal/agent + internal/compact + internal/mcp + commands.go from
// main.go, without the Bubble Tea TUI (the migration to Ink is an optional
// step, included alongside this one — see src/tui.tsx).

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { buildCompactor } from "./context/compactor.js";
import { buildWriteDiff } from "./tools/diff.js";
import { reportFatal } from "./errors.js";
import { harnessConfig } from "./harness-config.js";
import { createMemoryStore, finalizeSession } from "./memory/index.js";
import { connectMCPServers, loadConfig, registerMCPTools } from "./mcp/register.js";
import { createProvider } from "./provider/index.js";
import type { Provider } from "./provider/types.js";
import { SkillRegistry } from "./skills/registry.js";
import { registerCatalogTools, refreshSubagentTools } from "./tools/catalog.js";
import { ToolRegistry } from "./tools/registry.js";

async function main() {
  const provider = createProvider();

  // Falls back to NoMemory (with a warning) rather than failing the whole
  // process if .harness/ can't be set up - persistent memory is a nicety,
  // not a hard requirement to run the harness at all.
  const memorySession = await createMemoryStore();
  const systemPrompt = harnessConfig.systemPrompt + (await memorySession.store.preamble());

  const skillRegistry = await SkillRegistry.load();

  // mcp.json is optional (gitignored, like in Go) — its absence is not an
  // error, it simply means there are no remote tools to register. Connected
  // before registerCatalogTools() below (Phase 23) so a subagent's tool
  // pack (harnessConfig.subagents) can include an MCP tool - it needs the
  // servers already dialed to resolve one by name.
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

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const agent = new Agent({
    provider,
    tools,
    systemPrompt,
    compactor: buildCompactor(harnessConfig.compaction, provider),
    onToolCall: (name, rawInput) => console.log(`[tool] ${name} ${rawInput}`),
    // The text itself already reached stdout progressively via
    // onTextDelta below; onAssistantText firing (once, with the full
    // text) just means that block is done, so this only needs to close
    // out the line.
    onAssistantText: () => console.log(),
    onTextDelta: (chunk) => process.stdout.write(chunk),
    onRiskFlag: (name, risk, next) => console.log(`  ⚠ [${name}] risk: ${risk}${next ? ` — next: ${next}` : ""}`),
    confirm: async (name, rawInput) => {
      const diff = name === "write_file" ? buildWriteDiff(rawInput) : "";
      const answer = diff
        ? await rl.question(`${diff}\n  approve this write? [y/N] `)
        : await rl.question(`  approve "${name}" ${rawInput}? [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    },
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

  // Shared between the natural EOF exit (falls out of the loop below) and
  // Ctrl+C: without an explicit SIGINT handler, Node's default action is to
  // kill the process immediately with no cleanup and no goodbye.
  async function cleanup(): Promise<void> {
    await Promise.all(connectedMCP.map((c) => c.client.close()));
    // agent.provider, not the outer `provider` - /provider may have
    // swapped it mid-session, and summarizing with a stale reference
    // would silently use the wrong backend/model.
    await finalizeSession(agent.provider, agent.getMessages(), memorySession);
    console.log("\nBye!");
  }
  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
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

    if (await runCommand(input, { agent, log: console.log, switchProvider })) {
      console.log();
      continue;
    }

    await agent.send(input);
    console.log();
  }

  await cleanup();
}

main().catch(reportFatal);

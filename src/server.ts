// Phase 6 (optional): third entry point, same session as index.ts/tui.tsx
// (provider, tools, MCP, Agent) but accessed from the browser instead of
// the terminal. The Agent is already transport-agnostic (onToolCall,
// onAssistantText, confirm are callbacks) — here we simply wire them up
// against a WebSocket instead of console.log/Ink, same pattern as
// registerConfirm in tui.tsx/App.tsx.
//
// Single global session: every connection shares the same Agent, like
// several tabs of the same REPL. No queue or lock for concurrent inputs —
// meant for personal use, not multi-user.
//
// Bind exclusively to 127.0.0.1: bash and write_file are tools capable of
// altering the system; they must never be reachable from the local
// network.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { buildCompactor } from "./context/compactor.js";
import { reportFatal } from "./errors.js";
import { harnessConfig } from "./harness-config.js";
import { loadConfig, registerMCPServers } from "./mcp/register.js";
import type { MCPClient } from "./mcp/client.js";
import { createProvider } from "./provider/index.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { ToolRegistry } from "./tools/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PORT = Number(process.env.WEB_PORT) || 3003;

// Messages traveling server → client. `history` hydrates a new tab with
// the conversation already in progress, reusing the same
// Message[]/Block[] that agent.getMessages() exposes — no parallel log
// kept around.
type ServerMessage =
  | { type: "history"; messages: ReturnType<Agent["getMessages"]> }
  | { type: "user_text"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; input: string }
  | { type: "confirm_request"; name: string; input: string }
  | { type: "mode"; mode: "thinking" | "idle" }
  | { type: "error"; message: string };

// Messages client → server. `input` covers both normal messages and "/"
// commands — the server dispatches them the same way index.ts does
// (runCommand first, agent.send if it wasn't a command).
type ClientMessage = { type: "input"; line: string } | { type: "confirm_response"; approved: boolean };

async function main() {
  const provider = createProvider();

  const tools = new ToolRegistry();
  registerCatalogTools(tools, harnessConfig.tools);

  let mcpClients: MCPClient[] = [];
  const mcpConfig = await loadConfig("mcp.json");
  if (mcpConfig) {
    mcpClients = await registerMCPServers(mcpConfig, tools);
  }

  const sockets = new Set<WebSocket>();
  function broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  // Same as pendingApproval in App.tsx: since the agent loop waits for the
  // confirmation before continuing, there's never more than one pending at
  // a time — no need for an id to correlate request/response.
  let pendingApproval: { resolve: (approved: boolean) => void } | null = null;

  const agent = new Agent({
    provider,
    tools,
    compactor: buildCompactor(harnessConfig.compaction),
    onToolCall: (name, rawInput) => broadcast({ type: "tool_call", name, input: rawInput }),
    onAssistantText: (text) => broadcast({ type: "assistant_text", text }),
    confirm: (name, rawInput) =>
      new Promise<boolean>((resolve) => {
        pendingApproval = { resolve };
        broadcast({ type: "confirm_request", name, input: rawInput });
      }),
  });

  const indexHtmlPath = path.join(__dirname, "web", "index.html");

  const httpServer = createServer((req, res) => {
    if (req.method !== "GET" || (req.url !== "/" && req.url !== "/index.html")) {
      res.writeHead(404).end("not found");
      return;
    }
    readFile(indexHtmlPath)
      .then((html) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
      })
      .catch((err) => {
        res.writeHead(500).end(`error reading index.html: ${(err as Error).message}`);
      });
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "history", messages: agent.getMessages() } satisfies ServerMessage));

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "confirm_response") {
        pendingApproval?.resolve(msg.approved);
        pendingApproval = null;
        return;
      }

      if (msg.type === "input") {
        const line = msg.line.trim();
        if (!line) return;

        // Broadcast the text exactly as typed, not just the reply — this
        // way a second tab sees both what was typed and what the model
        // answered, whether it's a "/" command or not.
        broadcast({ type: "user_text", text: line });

        if (runCommand(line, { agent })) return;

        void (async () => {
          broadcast({ type: "mode", mode: "thinking" });
          try {
            await agent.send(line);
          } catch (err) {
            broadcast({ type: "error", message: (err as Error).message });
          } finally {
            broadcast({ type: "mode", mode: "idle" });
          }
        })();
      }
    });

    socket.on("close", () => sockets.delete(socket));
  });

  httpServer.listen(WEB_PORT, "127.0.0.1", () => {
    console.log(`boilerplate-harness — model: ${provider.model}`);
    console.log(`tools: ${tools.definitions().map((t) => t.name).join(", ")}`);
    console.log(`listening on http://127.0.0.1:${WEB_PORT} (localhost only)`);
  });

  process.on("SIGINT", async () => {
    await Promise.all(mcpClients.map((c) => c.close()));
    process.exit(0);
  });
}

main().catch(reportFatal);

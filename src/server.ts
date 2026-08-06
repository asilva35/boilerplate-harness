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
//
// Phase 10 swaps what's served at "/" for the built web-app/ (React +
// Vite + shadcn/ui) client, without touching a single line of the
// WebSocket protocol below — it's the same "sin magia" vanilla client
// from Phase 6, still reachable at /legacy for reference.

import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { buildCompactor } from "./context/compactor.js";
import { buildWriteDiff } from "./tools/diff.js";
import { reportFatal } from "./errors.js";
import { harnessConfig } from "./harness-config.js";
import { loadConfig, registerMCPServers } from "./mcp/register.js";
import type { MCPClient } from "./mcp/client.js";
import { createProvider } from "./provider/index.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { ToolRegistry } from "./tools/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PORT = Number(process.env.WEB_PORT) || 3003;
const WEB_APP_DIST = path.join(__dirname, "..", "web-app", "dist");
const LEGACY_HTML_PATH = path.join(__dirname, "web", "index.html");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

// Messages traveling server → client. `history` hydrates a new tab with
// the conversation already in progress, reusing the same
// Message[]/Block[] that agent.getMessages() exposes — no parallel log
// kept around.
type ServerMessage =
  | { type: "history"; messages: ReturnType<Agent["getMessages"]> }
  | { type: "user_text"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; input: string }
  | { type: "confirm_request"; name: string; input: string; diff?: string }
  | { type: "mode"; mode: "thinking" | "idle" }
  | { type: "error"; message: string }
  | { type: "command_output"; text: string };

// Messages client → server. `input` covers both normal messages and "/"
// commands — the server dispatches them the same way index.ts does
// (runCommand first, agent.send if it wasn't a command).
type ClientMessage = { type: "input"; line: string } | { type: "confirm_response"; approved: boolean };

// Serves the Phase 10 React build (web-app/dist). There's no client-side
// router in this app, so an unmatched path only really matters for "/" -
// falling back to index.html keeps the shape a real SPA route would need
// if one gets added later.
async function serveWebApp(url: string, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent(url.split("?")[0] ?? "/");
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.join(WEB_APP_DIST, relativePath);

  // Path traversal guard (e.g. a request for "/../../etc/passwd").
  if (filePath !== WEB_APP_DIST && !filePath.startsWith(WEB_APP_DIST + path.sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const mime = MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": mime }).end(data);
  } catch {
    try {
      const html = await readFile(path.join(WEB_APP_DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    } catch (err) {
      res
        .writeHead(500)
        .end(
          `error reading web-app/dist/index.html: ${(err as Error).message}\n\n` +
            `Did you run "npm run build" inside web-app/?`,
        );
    }
  }
}

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
    onTextDelta: (chunk) => broadcast({ type: "text_delta", text: chunk }),
    confirm: (name, rawInput) =>
      new Promise<boolean>((resolve) => {
        pendingApproval = { resolve };
        const diff = name === "write_file" ? buildWriteDiff(rawInput) : "";
        broadcast({ type: "confirm_request", name, input: rawInput, diff: diff || undefined });
      }),
  });

  const httpServer = createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(404).end("not found");
      return;
    }

    if (req.url === "/legacy" || req.url === "/legacy/") {
      readFile(LEGACY_HTML_PATH)
        .then((html) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html))
        .catch((err) => res.writeHead(500).end(`error reading web/index.html: ${(err as Error).message}`));
      return;
    }

    void serveWebApp(req.url ?? "/", res);
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

        if (
          runCommand(line, {
            agent,
            log: (text) => broadcast({ type: "command_output", text }),
            refreshHistory: () => broadcast({ type: "history", messages: agent.getMessages() }),
          })
        )
          return;

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

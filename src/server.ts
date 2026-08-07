// Phase 6 (optional): third entry point, same session as index.ts/tui.tsx
// (provider, tools, MCP, Agent) but accessed from the browser instead of
// the terminal. The Agent is already transport-agnostic (onToolCall,
// onAssistantText, confirm are callbacks) — here we simply wire them up
// against a WebSocket instead of console.log/Ink, same pattern as
// registerConfirm in tui.tsx/App.tsx.
//
// Phase 20 replaced the single global Agent this file used to build once
// at startup with a SessionManager: N independent conversations, keyed by
// a `?session=` query param on the WebSocket handshake. Several tabs with
// the same id still share one conversation (the Phase 6 behavior), but
// different ids no longer step on each other. No queue or lock for
// concurrent inputs within a session — still meant for personal/small-team
// use, not a production multi-tenant server.
//
// Bind exclusively to 127.0.0.1: bash and write_file are tools capable of
// altering the system; they must never be reachable from the local
// network.
//
// Phase 10 swaps what's served at "/" for the built web-app/ (React +
// Vite + shadcn/ui) client, without touching a single line of the
// WebSocket protocol below — it's the same "sin magia" vanilla client
// from Phase 6, still reachable at /legacy for reference.

import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { setSink } from "./debug.js";
import { reportFatal } from "./errors.js";
import { harnessConfig } from "./harness-config.js";
import { createMemoryStore, finalizeSessions } from "./memory/index.js";
import { connectMCPServers, loadConfig } from "./mcp/register.js";
import { createProvider } from "./provider/index.js";
import { SessionManager, type Session } from "./session/manager.js";
import type { ClientMessage, ServerMessage } from "./session/protocol.js";
import { SkillRegistry } from "./skills/registry.js";

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

// Broadcasts to every socket attached to one session - the scoped
// equivalent of the single global broadcast() this file had pre-Phase 20.
// (Everything the Agent itself pushes - tool_call, assistant_text, etc. -
// is already scoped the same way inside SessionManager; this covers the
// handful of messages server.ts sends directly: user_text/mode/error/
// command_output.)
function broadcastTo(session: Session, msg: ServerMessage): void {
  const payload = JSON.stringify(msg);
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

async function main() {
  const provider = createProvider();

  const memorySession = await createMemoryStore();
  const systemPrompt = harnessConfig.systemPrompt + (await memorySession.store.preamble());
  const skillRegistry = await SkillRegistry.load();

  const mcpConfig = await loadConfig("mcp.json");
  const connectedMCP = mcpConfig ? await connectMCPServers(mcpConfig) : [];

  const sessionManager = new SessionManager({
    harnessConfig,
    provider,
    memoryStore: memorySession.store,
    skillRegistry,
    systemPrompt,
    connectedMCP,
  });

  // Debug events (Phase 19) aren't scoped to a session - debug.ts is a
  // process-wide singleton with no notion of which conversation triggered
  // a given record() call, so every connected tab across every session
  // sees the same live stream. Tracked separately from each session's own
  // socket set for exactly that reason.
  const debugSockets = new Set<WebSocket>();
  setSink((event) => {
    const payload = JSON.stringify({ type: "debug_event", event } satisfies ServerMessage);
    for (const socket of debugSockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
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

  wss.on("connection", (socket, req) => {
    // Phase 20 handshake: ?session=<id> identifies or creates a
    // conversation; ?user=<id> is a separate, deliberately loose
    // identifier (real auth doesn't land until Phase 33's tokens) - a user
    // can hold several sessions, so it's tracked apart from sessionId
    // rather than reusing it. Neither client ships one, they're generated
    // here and only meaningful for the lifetime of this connection unless
    // the client remembers and resends the same id (see useHarnessSocket.ts
    // and web/index.html).
    const url = new URL(req.url ?? "/", "http://localhost");
    const sessionId = url.searchParams.get("session") ?? randomUUID();
    const userId = url.searchParams.get("user") ?? "local";
    const session = sessionManager.get(sessionId, userId);

    session.sockets.add(socket);
    debugSockets.add(socket);
    socket.send(JSON.stringify({ type: "history", messages: session.agent.getMessages() } satisfies ServerMessage));

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "confirm_response") {
        session.pendingApproval?.resolve(msg.approved);
        session.pendingApproval = null;
        return;
      }

      if (msg.type === "input") {
        const line = msg.line.trim();
        if (!line) return;

        // Broadcast the text exactly as typed, not just the reply — this
        // way a second tab sees both what was typed and what the model
        // answered, whether it's a "/" command or not.
        broadcastTo(session, { type: "user_text", text: line });

        void (async () => {
          if (
            await runCommand(line, {
              agent: session.agent,
              log: (text) => broadcastTo(session, { type: "command_output", text }),
              refreshHistory: () => broadcastTo(session, { type: "history", messages: session.agent.getMessages() }),
            })
          )
            return;

          broadcastTo(session, { type: "mode", mode: "thinking" });
          try {
            await session.agent.send(line);
          } catch (err) {
            broadcastTo(session, { type: "error", message: (err as Error).message });
          } finally {
            broadcastTo(session, { type: "mode", mode: "idle" });
          }
        })();
      }
    });

    socket.on("close", () => {
      session.sockets.delete(socket);
      debugSockets.delete(socket);
    });
  });

  httpServer.listen(WEB_PORT, "127.0.0.1", () => {
    const mcpToolNames = connectedMCP.flatMap((s) => s.defs.map((d) => `${s.name}_${d.name}`));
    console.log(`boilerplate-harness — model: ${provider.model}`);
    console.log(`tools: ${[...harnessConfig.tools, ...mcpToolNames].join(", ")}`);
    console.log(`listening on http://127.0.0.1:${WEB_PORT} (localhost only)`);
  });

  process.on("SIGINT", async () => {
    await Promise.all(connectedMCP.map((c) => c.client.close()));
    await finalizeSessions(
      provider,
      sessionManager.all().map((s) => s.agent.getMessages()),
      memorySession,
    );
    process.exit(0);
  });
}

main().catch(reportFatal);

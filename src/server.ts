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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Agent } from "./agent.js";
import { runCommand } from "./commands.js";
import { config } from "./config.js";
import { setSink } from "./debug.js";
import { pdfToBlocks } from "./documents/pdf.js";
import { ConfigError, reportFatal } from "./errors.js";
import { harnessConfig, ProfileRegistry } from "./harness-config.js";
import { toMarkdown } from "./history/export.js";
import { ChatHistoryStore } from "./history/store.js";
import { createMemoryStore, finalizeSessions } from "./memory/index.js";
import { connectMCPServers, loadConfig } from "./mcp/register.js";
import type { Block } from "./provider/types.js";
import { createProvider } from "./provider/index.js";
import { SessionManager, summarizeSession, type Session } from "./session/manager.js";
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

// Phase 28: reads and JSON-parses a request body for PATCH /api/chats/:id.
// The other routes below are all query-string driven (GET), so this is the
// only handler that needs one.
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

// A chat's title is user-controlled (rename via PATCH) and ends up in a
// Content-Disposition header for exports - stripped down to a safe,
// unquoted filename fragment rather than escaped, since nothing here needs
// non-ASCII or punctuation to round-trip.
function sanitizeFilename(title: string): string {
  return title.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 60);
}

// Best-effort archive write, called after every completed turn and once
// more per session on shutdown (see the SIGINT handler below) - "at close,
// or periodically" per the guide. Never lets a persistence failure surface
// as a broken turn: the live conversation already succeeded or failed on
// its own terms by the time this runs.
async function persistChat(chatHistory: ChatHistoryStore, session: Session): Promise<void> {
  try {
    await chatHistory.upsert({
      id: session.id,
      userId: session.userId,
      role: session.role,
      profile: session.profile,
      messages: session.agent.getMessages(),
    });
  } catch (err) {
    console.error(`chat history: failed to persist session ${session.id}: ${(err as Error).message}`);
  }
}

async function main() {
  const memorySession = await createMemoryStore();
  // Phase 22: no longer baked into one fixed systemPrompt - each session
  // resolves its own profile's systemPrompt and appends this same preamble
  // (recent-sessions memory doesn't vary by profile).
  const memoryPreamble = await memorySession.store.preamble();
  const skillRegistry = await SkillRegistry.load();

  const mcpConfig = await loadConfig("mcp.json");
  const connectedMCP = mcpConfig ? await connectMCPServers(mcpConfig) : [];

  // Phase 28: the saved-conversations archive backing the web "Chats"
  // list - separate from memorySession above (Phase 16, what the *agent*
  // recalls) and from the SessionManager below (Phase 20, live in-process
  // sessions only, gone on restart).
  const chatHistory = await ChatHistoryStore.open();

  const sessionManager = new SessionManager({
    profiles: new ProfileRegistry(),
    // Phase 25: a fresh Provider per session instead of one shared
    // instance - each session accumulates its own token usage/cost and
    // can switch model/backend (/model, /provider) independently of every
    // other concurrent session. Same function used for a session's
    // initial provider (called with no args) and for "/provider" swaps
    // (called with explicit name/model) - see SessionManager.
    createProvider,
    memoryStore: memorySession.store,
    skillRegistry,
    memoryPreamble,
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
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && (url.pathname === "/legacy" || url.pathname === "/legacy/")) {
      readFile(LEGACY_HTML_PATH)
        .then((html) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html))
        .catch((err) => res.writeHead(500).end(`error reading web/index.html: ${(err as Error).message}`));
      return;
    }

    // Phase 27: the dashboard's data source (web-app/src's DashboardPage) -
    // a plain snapshot fetch, not pushed over the WebSocket like everything
    // else, since it's read on demand rather than something a session
    // streams as it happens.
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const summaries = sessionManager.all().map(summarizeSession);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(summaries));
      return;
    }

    // Phase 28: the saved-chats archive - list/rename/pin/export, backing
    // web-app's ChatHistoryPage. Unlike /api/sessions above, this survives
    // a server restart (it's reading chatHistory's on-disk index, not the
    // in-memory SessionManager).
    if (req.method === "GET" && url.pathname === "/api/chats") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(chatHistory.list()));
      return;
    }

    const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
    if (chatMatch) {
      const id = decodeURIComponent(chatMatch[1]);
      if (req.method !== "PATCH") {
        res.writeHead(405).end("method not allowed");
        return;
      }
      void (async () => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          res.writeHead(400).end("invalid JSON body");
          return;
        }
        const { title, pinned } = (body ?? {}) as { title?: unknown; pinned?: unknown };
        try {
          const summary = await chatHistory.update(id, {
            title: typeof title === "string" ? title : undefined,
            pinned: typeof pinned === "boolean" ? pinned : undefined,
          });
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(summary));
        } catch (err) {
          if (err instanceof ConfigError) {
            res.writeHead(404).end(err.message);
          } else {
            res.writeHead(500).end((err as Error).message);
          }
        }
      })();
      return;
    }

    const exportMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/export$/);
    if (exportMatch) {
      if (req.method !== "GET") {
        res.writeHead(405).end("method not allowed");
        return;
      }
      const id = decodeURIComponent(exportMatch[1]);
      void chatHistory.get(id).then((record) => {
        if (!record) {
          res.writeHead(404).end("not found");
          return;
        }
        const format = url.searchParams.get("format") === "json" ? "json" : "md";
        const filename = `${sanitizeFilename(record.title) || record.id}.${format}`;
        if (format === "json") {
          res
            .writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "content-disposition": `attachment; filename="${filename}"`,
            })
            .end(JSON.stringify(record, null, 2));
        } else {
          res
            .writeHead(200, {
              "content-type": "text/markdown; charset=utf-8",
              "content-disposition": `attachment; filename="${filename}"`,
            })
            .end(toMarkdown(record));
        }
      });
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(404).end("not found");
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
    // Phase 21: ?role=<role>, same "no real auth yet" caveat as userId
    // above - defaults to "admin" so a caller that never heard of roles
    // gets exactly the pre-Phase-21 behavior (the full harnessConfig.tools
    // list).
    const role = url.searchParams.get("role") ?? "admin";
    // Phase 22: ?profile=<name>, defaulting to "default" (harness.config.json
    // as-is) - same opt-in philosophy as roles: a caller that never heard
    // of profiles gets exactly the pre-Phase-22 behavior.
    const profile = url.searchParams.get("profile") ?? "default";

    let session: Session;
    try {
      session = sessionManager.get(sessionId, userId, role, profile);
    } catch (err) {
      // Unknown role/profile, or a role/profile mismatch against an
      // already-open session - a caller error, not a server bug: tell
      // just this socket and close, don't take down every other session.
      socket.send(JSON.stringify({ type: "error", message: (err as Error).message } satisfies ServerMessage));
      socket.close();
      return;
    }

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
        // Phase 29/30: an image or document with no caption is still a
        // valid send - only reject the truly empty case. A "/" command
        // never carries attachments (runCommand's own
        // `!line.startsWith("/")` guard already makes an empty `line` a
        // no-op there either way).
        const images = msg.images ?? [];
        const documents = msg.documents ?? [];
        if (!line && images.length === 0 && documents.length === 0) return;

        void (async () => {
          // Phase 30: a PDF becomes Blocks (extracted text, or rendered
          // page images for a "mostly visual" one) before anything is
          // broadcast or sent - both the live echo and the Agent need the
          // result, not the raw upload. Rendered page images join the
          // same `images` array a genuine photo attachment would use, so
          // a live viewer sees them exactly the same way (see
          // session/protocol.ts's ServerMessage.user_text doc comment).
          const documentBlocks: Block[] = [];
          const documentMeta: { filename: string; mediaType: string }[] = [];
          const liveImages = [...images];
          for (const doc of documents) {
            if (doc.mediaType !== "application/pdf") continue; // fail closed - same allowlist spirit as ChatInput's image mediaType check
            try {
              const { blocks, mode } = await pdfToBlocks(Buffer.from(doc.data, "base64"), doc.filename);
              documentBlocks.push(...blocks);
              documentMeta.push({ filename: doc.filename, mediaType: doc.mediaType });
              if (mode === "images") {
                for (const b of blocks) if (b.type === "image") liveImages.push({ mediaType: b.mediaType, data: b.data });
              }
            } catch (err) {
              broadcastTo(session, { type: "command_output", text: `document "${doc.filename}": ${(err as Error).message}` });
            }
          }

          // Broadcast the text exactly as typed, not just the reply — this
          // way a second tab sees both what was typed and what the model
          // answered, whether it's a "/" command or not.
          broadcastTo(session, {
            type: "user_text",
            text: line,
            images: liveImages.length ? liveImages : undefined,
            documents: documentMeta.length ? documentMeta : undefined,
          });

          if (
            await runCommand(line, {
              agent: session.agent,
              log: (text) => broadcastTo(session, { type: "command_output", text }),
              refreshHistory: () => broadcastTo(session, { type: "history", messages: session.agent.getMessages() }),
              switchProvider: (name, model) => session.switchProvider(name, model),
              // Phase 27: every session the process currently holds, not
              // just this one - /stats here is an overview, "my own
              // numbers" is still what /tokens is for.
              listSessions: () => sessionManager.all().map(summarizeSession),
            })
          )
            return;

          broadcastTo(session, { type: "mode", mode: "thinking" });
          try {
            const imageBlocks: Block[] = images.map((img) => ({ type: "image", mediaType: img.mediaType, data: img.data }));
            await session.agent.send(line, [...imageBlocks, ...documentBlocks]);
          } catch (err) {
            broadcastTo(session, { type: "error", message: (err as Error).message });
          } finally {
            broadcastTo(session, { type: "mode", mode: "idle" });
            await persistChat(chatHistory, session);
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
    // Phase 25: no single provider instance to read .model off anymore -
    // each session builds its own. This just reports what a NEW session
    // will default to (env config), not any particular session's current
    // model (which /model can change independently per session).
    console.log(`boilerplate-harness — default provider: ${config.llmProvider} (model: ${config.llmModel || "(provider default)"})`);
    console.log(`tools: ${[...harnessConfig.tools, ...mcpToolNames].join(", ")}`);
    console.log(`listening on http://127.0.0.1:${WEB_PORT} (localhost only)`);
  });

  process.on("SIGINT", async () => {
    await Promise.all(connectedMCP.map((c) => c.client.close()));
    // Final archive flush - covers the edge case where a session's last
    // mutation was a command (e.g. /clear) rather than a send(), which is
    // the only other place persistChat() runs. Each session's own turn
    // handler already keeps chatHistory current turn-by-turn, so this is a
    // safety net, not the primary write path.
    await Promise.all(sessionManager.all().map((s) => persistChat(chatHistory, s)));
    await finalizeSessions(
      sessionManager.all().map((s) => ({ provider: s.agent.provider, messages: s.agent.getMessages() })),
      memorySession,
    );
    process.exit(0);
  });
}

main().catch(reportFatal);

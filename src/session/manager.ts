// Phase 20: replaces the single global Agent that server.ts used to build
// once at startup. A SessionManager holds N independent conversations
// (sessionId -> Session), each with its own Agent/ToolRegistry/compactor
// and its own set of connected sockets/pending approval - but sharing the
// process-wide resources that are expensive or stateless anyway (Provider,
// MemoryStore, SkillRegistry, connected MCP clients).

import type { WebSocket } from "ws";
import { Agent } from "../agent.js";
import { buildCompactor } from "../context/compactor.js";
import type { HarnessConfig } from "../harness-config.js";
import type { MemoryStore } from "../memory/types.js";
import { type ConnectedMCPServer, registerMCPTools } from "../mcp/register.js";
import type { Provider } from "../provider/types.js";
import type { ServerMessage } from "./protocol.js";
import type { SkillRegistry } from "../skills/registry.js";
import { registerCatalogTools } from "../tools/catalog.js";
import { buildWriteDiff } from "../tools/diff.js";
import { ToolRegistry } from "../tools/registry.js";

export interface Session {
  readonly id: string;
  readonly userId: string;
  // Not readonly: create() below has to construct this after `session`
  // itself exists, since the Agent's confirm callback closes over `session`
  // to set pendingApproval.
  agent: Agent;
  readonly tools: ToolRegistry;
  readonly sockets: Set<WebSocket>;
  pendingApproval: { resolve: (approved: boolean) => void } | null;
}

export interface SessionManagerOptions {
  harnessConfig: HarnessConfig;
  provider: Provider;
  memoryStore: MemoryStore;
  skillRegistry: SkillRegistry;
  systemPrompt: string;
  connectedMCP: ConnectedMCPServer[];
}

// Same reasoning as Go having none of this: the CLI is a single process
// with a single conversation. The web entry point is the only one that
// needs to multiplex.
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly opts: SessionManagerOptions) {}

  // Returns the existing session for `id`, or builds a new one. Several
  // sockets calling get() with the same id share the same Session object
  // (and therefore the same Agent/conversation) - same behavior the single
  // global Agent gave every tab for free before this phase.
  get(id: string, userId: string): Session {
    const existing = this.sessions.get(id);
    if (existing) return existing;

    const session = this.create(id, userId);
    this.sessions.set(id, session);
    return session;
  }

  all(): Session[] {
    return [...this.sessions.values()];
  }

  private create(id: string, userId: string): Session {
    const tools = new ToolRegistry();
    registerCatalogTools(tools, this.opts.harnessConfig.tools, this.opts.provider, this.opts.memoryStore, this.opts.skillRegistry);
    registerMCPTools(tools, this.opts.connectedMCP);

    const sockets = new Set<WebSocket>();
    const broadcast = (msg: ServerMessage): void => {
      const payload = JSON.stringify(msg);
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) socket.send(payload);
      }
    };

    // Mutated by the closures below (confirm/pendingApproval), so it's
    // declared before the Agent that captures them and filled in after.
    const session: Session = {
      id,
      userId,
      tools,
      sockets,
      pendingApproval: null,
      agent: undefined as unknown as Agent,
    };

    session.agent = new Agent({
      provider: this.opts.provider,
      tools,
      systemPrompt: this.opts.systemPrompt,
      compactor: buildCompactor(this.opts.harnessConfig.compaction, this.opts.provider),
      onToolCall: (name, rawInput) => broadcast({ type: "tool_call", name, input: rawInput }),
      onAssistantText: (text) => broadcast({ type: "assistant_text", text }),
      onTextDelta: (chunk) => broadcast({ type: "text_delta", text: chunk }),
      onRiskFlag: (name, risk, nextRecommended) => broadcast({ type: "risk_flag", name, risk, nextRecommended }),
      confirm: (name, rawInput) =>
        new Promise<boolean>((resolve) => {
          session.pendingApproval = { resolve };
          const diff = name === "write_file" ? buildWriteDiff(rawInput) : "";
          broadcast({ type: "confirm_request", name, input: rawInput, diff: diff || undefined });
        }),
    });

    return session;
  }
}

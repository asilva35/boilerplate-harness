// Phase 20: replaces the single global Agent that server.ts used to build
// once at startup. A SessionManager holds N independent conversations
// (sessionId -> Session), each with its own Agent/ToolRegistry/compactor
// and its own set of connected sockets/pending approval - but sharing the
// process-wide resources that are expensive or stateless anyway (Provider,
// MemoryStore, SkillRegistry, connected MCP clients).

import type { WebSocket } from "ws";
import { Agent } from "../agent.js";
import { buildCompactor } from "../context/compactor.js";
import { ConfigError } from "../errors.js";
import { resolveRoleTools, type HarnessConfig } from "../harness-config.js";
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
  // Phase 21: fixed at creation - the ToolRegistry below is one shared
  // object for every socket attached to this session, so there's no way
  // to give two sockets on the same session different tool visibility.
  // See the mismatch check in get() below.
  readonly role: string;
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
  // (and therefore the same Agent/conversation and tool set) - same
  // behavior the single global Agent gave every tab for free before Phase
  // 20. A reconnect claiming a different role than the session was
  // created with is rejected rather than silently attached - the
  // ToolRegistry is a single shared object per session, so there's no
  // such thing as "join with a different role" once it's already built.
  get(id: string, userId: string, role: string): Session {
    const existing = this.sessions.get(id);
    if (existing) {
      if (existing.role !== role) {
        throw new ConfigError(
          `Session "${id}" was created with role "${existing.role}", got "${role}" - reconnect with ` +
            "the same role, or use a different session id.",
        );
      }
      return existing;
    }

    const session = this.create(id, userId, role);
    this.sessions.set(id, session);
    return session;
  }

  all(): Session[] {
    return [...this.sessions.values()];
  }

  private create(id: string, userId: string, role: string): Session {
    const toolNames = resolveRoleTools(this.opts.harnessConfig, role);
    const tools = new ToolRegistry();
    registerCatalogTools(tools, toolNames, this.opts.provider, this.opts.memoryStore, this.opts.skillRegistry);
    // Not role-gated: MCP servers are a separate opt-in (mcp.json), not
    // part of harnessConfig.tools/roles, and every MCP tool already
    // requires approval unconditionally regardless of role (Phase 5).
    // Gating individual MCP tools per role is real scope, deferred.
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
      role,
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

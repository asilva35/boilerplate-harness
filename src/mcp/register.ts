// Equivalent to internal/mcp/register.go: reads mcp.json, connects each
// listed server, and registers its tools in the local Registry under
// "<server>_<tool>" to avoid name collisions between servers (or with
// local tools). A server that fails is skipped with a stderr warning —
// losing one shouldn't take down the harness.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolResult } from "../tools/types.js";
import { MCPClient, type MCPToolDef } from "./client.js";

interface ServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

interface Config {
  servers: ServerConfig[];
}

// Expands ${VAR} against process.env — equivalent to os.ExpandEnv in Go.
// This way mcp.json can reference secrets (e.g. ${GITHUB_TOKEN}) without
// having them written in the file.
function expandEnv(s: string): string {
  return s.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? "");
}

// Missing config = MCP is opt-in; not an error, same as Go (LoadConfig
// returns (nil, nil) if the file doesn't exist).
export async function loadConfig(path: string): Promise<Config | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as Config;
}

export async function registerMCPServers(config: Config, registry: ToolRegistry): Promise<MCPClient[]> {
  const clients: MCPClient[] = [];

  for (const server of config.servers) {
    let client: MCPClient;
    try {
      client = await dial(server);
    } catch (err) {
      console.error(`mcp: skip server "${server.name}": ${(err as Error).message}`);
      continue;
    }

    let defs: MCPToolDef[];
    try {
      defs = await client.listTools();
    } catch (err) {
      console.error(`mcp: list tools from "${server.name}" failed: ${(err as Error).message}`);
      await client.close();
      continue;
    }

    for (const def of defs) {
      registry.register(toLocalTool(server.name, client, def));
    }

    clients.push(client);
    console.log(`mcp: connected "${server.name}" (${defs.length} tools)`);
  }

  return clients;
}

function dial(s: ServerConfig): Promise<MCPClient> {
  switch (s.transport) {
    case "stdio": {
      if (!s.command) throw new Error(`stdio server "${s.name}" missing command`);
      return MCPClient.stdio(s.name, expandEnv(s.command), (s.args ?? []).map(expandEnv));
    }
    case "http": {
      if (!s.url) throw new Error(`http server "${s.name}" missing url`);
      const headers = Object.fromEntries(
        Object.entries(s.headers ?? {}).map(([k, v]) => [k, expandEnv(v)]),
      );
      return MCPClient.http(s.name, expandEnv(s.url), headers);
    }
    default:
      return Promise.reject(new Error(`unknown transport "${s.transport}" (want stdio or http)`));
  }
}

// No Zod schema of its own to validate arguments — the real JSON Schema
// already travels to the model via `toolDef` (see tools/types.ts), and the
// remote server is the ultimate validator. z.record accepts any object, so
// it acts as a passthrough instead of blocking legitimate calls with a
// redundant local validation.
function toLocalTool(serverName: string, client: MCPClient, def: MCPToolDef): Tool<Record<string, unknown>> {
  return {
    name: `${serverName}_${def.name}`,
    description: def.description,
    schema: z.record(z.string(), z.unknown()),
    toolDef: {
      name: `${serverName}_${def.name}`,
      description: def.description,
      inputSchema: def.inputSchema,
      required: def.required,
    },
    // Tools from external servers are of unknown trust by default —
    // unlike our local tools (Phase 3), all of them ask for [y/N]
    // approval, with no distinction by risk.
    requiresConfirmation: true,
    async execute(args): Promise<ToolResult> {
      return client.callTool(def.name, args);
    },
  };
}

// Equivalent to internal/mcp/client.go: wraps an MCP session (stdio or
// HTTP) behind a minimal interface — listTools/callTool/close — so
// register.ts can treat it the same regardless of transport.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  required: string[];
}

export class MCPClient {
  readonly name: string;
  private readonly client: Client;

  private constructor(name: string, client: Client) {
    this.name = name;
    this.client = client;
  }

  // Spawns command/args as a subprocess and connects over its stdin/stdout.
  static async stdio(name: string, command: string, args: string[] = []): Promise<MCPClient> {
    return MCPClient.connect(name, new StdioClientTransport({ command, args }));
  }

  // Connects to a remote server via Streamable HTTP. Headers (auth tokens,
  // API keys) travel on every request via requestInit.
  static async http(name: string, url: string, headers: Record<string, string> = {}): Promise<MCPClient> {
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
    return MCPClient.connect(name, transport);
  }

  private static async connect(name: string, transport: Transport): Promise<MCPClient> {
    const client = new Client({ name: "boilerplate-harness", version: "0.1.0" });
    await client.connect(transport);
    return new MCPClient(name, client);
  }

  async listTools(): Promise<MCPToolDef[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema.properties ?? {},
      required: t.inputSchema.required ?? [],
    }));
  }

  // The response content can carry text, image, audio blocks, etc. Our
  // local Tool only returns a string — same as Go, we render text as-is
  // and other blocks as a placeholder instead of silently dropping them.
  async callTool(name: string, args: Record<string, unknown>): Promise<{ result: string; isError: boolean }> {
    const res = await this.client.callTool({ name, arguments: args });
    // callTool() can return a "task-based" result (no `content`, with
    // `toolResult` instead) for tools that require it — none of the
    // servers we tested use it, so we treat that case as "no text
    // content" instead of failing. The SDK's type is a union that's hard
    // to narrow cleanly here; we do the check by hand at runtime instead
    // of fighting the compiler over a case we don't exercise.
    const content = (res as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return { result: JSON.stringify((res as { toolResult?: unknown }).toolResult), isError: false };
    }
    const text = (content as Array<{ type: string; text?: string }>)
      .map((block) => (block.type === "text" ? (block.text ?? "") : `[non-text content block: ${block.type}]`))
      .join("\n");
    return { result: text, isError: Boolean((res as { isError?: boolean }).isError) };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

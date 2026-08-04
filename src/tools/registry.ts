// Equivalent to internal/tool/registry.go: a Map of tools by name, with
// Definitions() to expose them to the provider and Execute() to dispatch a
// call by name. Go sorts by name to keep the payload deterministic
// (important for prompt caching); we do the same here.

import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDef } from "../provider/types.js";
import type { Tool, ToolResult } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  definitions(): ToolDef[] {
    return [...this.tools.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toToolDef);
  }

  requiresConfirmation(name: string): boolean {
    return this.tools.get(name)?.requiresConfirmation ?? false;
  }

  async execute(name: string, rawInput: string): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { result: `unknown tool: ${name}`, isError: true };

    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(rawInput);
    } catch (err) {
      return { result: `invalid tool input: ${(err as Error).message}`, isError: true };
    }

    const parsed = tool.schema.safeParse(rawParsed);
    if (!parsed.success) {
      return { result: `invalid tool input: ${parsed.error.message}`, isError: true };
    }

    try {
      return await tool.execute(parsed.data);
    } catch (err) {
      return { result: (err as Error).message, isError: true };
    }
  }
}

function toToolDef(tool: Tool): ToolDef {
  const schema = zodToJsonSchema(tool.schema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema.properties ?? {},
    required: schema.required ?? [],
  };
}

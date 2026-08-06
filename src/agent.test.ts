import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Agent } from "./agent.js";
import { MockProvider } from "./provider/mock.js";
import { ToolRegistry } from "./tools/registry.js";
import type { Tool, ToolResult } from "./tools/types.js";

const echoTool: Tool<{ text: string }> = {
  name: "echo",
  description: "Echoes back the given text.",
  schema: z.object({ text: z.string() }),
  execute({ text }): ToolResult {
    return { result: text, isError: false };
  },
};

const riskyTool: Tool<{ text: string }> = {
  name: "risky",
  description: "A tool that requires confirmation.",
  schema: z.object({ text: z.string() }),
  requiresConfirmation: true,
  execute({ text }): ToolResult {
    return { result: `did risky thing: ${text}`, isError: false };
  },
};

function registryWith(...tools: Tool[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  return registry;
}

test("returns plain text when the model makes no tool calls", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "hello there" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({ provider, tools: registryWith() });

  const result = await agent.send("hi");

  assert.equal(result, "hello there");
});

test("executes a tool call and feeds the result back to the provider", async () => {
  const provider = new MockProvider([
    {
      content: [
        { type: "tool_use", toolUseId: "1", toolName: "echo", toolInput: JSON.stringify({ text: "ping" }) },
      ],
      stopReason: "tool_use",
    },
    { content: [{ type: "text", text: "done" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({ provider, tools: registryWith(echoTool) });

  const result = await agent.send("echo ping");

  assert.equal(result, "done");
  const secondCallMessages = provider.calls[1].messages;
  const lastMessage = secondCallMessages[secondCallMessages.length - 1];
  assert.equal(lastMessage.role, "user");
  assert.deepEqual(lastMessage.content, [
    { type: "tool_result", toolUseId: "1", toolResult: "ping", isError: false },
  ]);
});

test("a denied confirmation short-circuits the tool call", async () => {
  const provider = new MockProvider([
    {
      content: [
        { type: "tool_use", toolUseId: "1", toolName: "risky", toolInput: JSON.stringify({ text: "boom" }) },
      ],
      stopReason: "tool_use",
    },
    { content: [{ type: "text", text: "ok, skipped it" }], stopReason: "end_turn" },
  ]);
  const agent = new Agent({
    provider,
    tools: registryWith(riskyTool),
    confirm: async () => false,
  });

  const result = await agent.send("do the risky thing");

  assert.equal(result, "ok, skipped it");
  const secondCallMessages = provider.calls[1].messages;
  const lastMessage = secondCallMessages[secondCallMessages.length - 1];
  assert.deepEqual(lastMessage.content, [
    { type: "tool_result", toolUseId: "1", toolResult: "user denied this tool call", isError: true },
  ]);
});

test("streams text via onTextDelta and still fires onAssistantText once with the full text at the end", async () => {
  const provider = new MockProvider([
    { content: [{ type: "text", text: "hello there" }], stopReason: "end_turn", textDeltas: ["hel", "lo ", "there"] },
  ]);
  const deltas: string[] = [];
  const finals: string[] = [];
  const agent = new Agent({
    provider,
    tools: registryWith(),
    onTextDelta: (chunk) => deltas.push(chunk),
    onAssistantText: (text) => finals.push(text),
  });

  const result = await agent.send("hi");

  assert.equal(result, "hello there");
  assert.deepEqual(deltas, ["hel", "lo ", "there"]);
  assert.deepEqual(finals, ["hello there"]);
});

test("throws once maxTurns is exceeded without ever contacting a real provider", async () => {
  const provider = new MockProvider(
    Array.from({ length: 5 }, () => ({
      content: [
        { type: "tool_use" as const, toolUseId: "x", toolName: "echo", toolInput: JSON.stringify({ text: "x" }) },
      ],
      stopReason: "tool_use" as const,
    })),
  );
  const agent = new Agent({ provider, tools: registryWith(echoTool), maxTurns: 1 });

  await assert.rejects(() => agent.send("loop forever"), /max turns \(1\) reached/);
});

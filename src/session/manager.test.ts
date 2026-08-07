import { test } from "node:test";
import assert from "node:assert/strict";
import type { HarnessConfig } from "../harness-config.js";
import { NoMemory } from "../memory/no-memory.js";
import { MockProvider } from "../provider/mock.js";
import { SkillRegistry } from "../skills/registry.js";
import { SessionManager } from "./manager.js";

const CONFIG: HarnessConfig = {
  systemPrompt: "test system prompt",
  tools: ["read_file"],
  compaction: { strategy: "none", keepLast: 20, tokenThreshold: 4000, summarizeThreshold: 40 },
};

function manager(): SessionManager {
  return new SessionManager({
    harnessConfig: CONFIG,
    provider: new MockProvider([]),
    memoryStore: new NoMemory(),
    skillRegistry: new SkillRegistry([]),
    systemPrompt: CONFIG.systemPrompt,
    connectedMCP: [],
  });
}

test("the same session id always returns the same Session (and Agent)", () => {
  const m = manager();
  const a = m.get("alice", "local");
  const b = m.get("alice", "local");

  assert.equal(a, b);
  assert.equal(a.agent, b.agent);
});

test("different session ids get independent Sessions with independent Agents", () => {
  const m = manager();
  const a = m.get("alice", "local");
  const b = m.get("bob", "local");

  assert.notEqual(a, b);
  assert.notEqual(a.agent, b.agent);
  assert.notEqual(a.tools, b.tools);
});

test("new sessions start with no pending approval and no attached sockets", () => {
  const session = manager().get("alice", "local");

  assert.equal(session.pendingApproval, null);
  assert.equal(session.sockets.size, 0);
});

test("all() lists every session created so far, not just the most recent", () => {
  const m = manager();
  m.get("alice", "local");
  m.get("bob", "local");
  m.get("alice", "local"); // repeat id - should not add a third entry

  const ids = m.all().map((s) => s.id).sort();
  assert.deepEqual(ids, ["alice", "bob"]);
});

test("resolves the tool names from harnessConfig.tools the same way a single-session entry point would", () => {
  const session = manager().get("alice", "local");
  assert.deepEqual(
    session.tools.definitions().map((t) => t.name),
    ["read_file"],
  );
});

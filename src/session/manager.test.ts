import { test } from "node:test";
import assert from "node:assert/strict";
import type { HarnessConfig } from "../harness-config.js";
import { NoMemory } from "../memory/no-memory.js";
import { MockProvider } from "../provider/mock.js";
import { SkillRegistry } from "../skills/registry.js";
import { SessionManager, type ProfileSource } from "./manager.js";

function makeConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    systemPrompt: "test system prompt",
    tools: ["read_file", "write_file", "bash"],
    compaction: { strategy: "none", keepLast: 20, tokenThreshold: 4000, summarizeThreshold: 40 },
    roles: { client: ["read_file"] },
    ...overrides,
  };
}

const DEFAULT_CONFIG = makeConfig();

// In-memory fake, no disk I/O - the real ProfileRegistry (Phase 22) reads
// harness.<name>.config.json files, which is exercised separately in
// harness-config.test.ts.
class FakeProfiles implements ProfileSource {
  constructor(private readonly configs: Record<string, HarnessConfig>) {}
  get(name: string): HarnessConfig {
    const config = this.configs[name];
    if (!config) throw new Error(`no fake profile "${name}"`);
    return config;
  }
}

function manager(profiles: Record<string, HarnessConfig> = { default: DEFAULT_CONFIG }): SessionManager {
  return new SessionManager({
    profiles: new FakeProfiles(profiles),
    provider: new MockProvider([]),
    memoryStore: new NoMemory(),
    skillRegistry: new SkillRegistry([]),
    memoryPreamble: "",
    connectedMCP: [],
  });
}

test("the same session id/role/profile always returns the same Session (and Agent)", () => {
  const m = manager();
  const a = m.get("alice", "local", "admin", "default");
  const b = m.get("alice", "local", "admin", "default");

  assert.equal(a, b);
  assert.equal(a.agent, b.agent);
});

test("different session ids get independent Sessions with independent Agents", () => {
  const m = manager();
  const a = m.get("alice", "local", "admin", "default");
  const b = m.get("bob", "local", "admin", "default");

  assert.notEqual(a, b);
  assert.notEqual(a.agent, b.agent);
  assert.notEqual(a.tools, b.tools);
});

test("new sessions start with no pending approval and no attached sockets", () => {
  const session = manager().get("alice", "local", "admin", "default");

  assert.equal(session.pendingApproval, null);
  assert.equal(session.sockets.size, 0);
});

test("all() lists every session created so far, not just the most recent", () => {
  const m = manager();
  m.get("alice", "local", "admin", "default");
  m.get("bob", "local", "admin", "default");
  m.get("alice", "local", "admin", "default"); // repeat id - should not add a third entry

  const ids = m.all().map((s) => s.id).sort();
  assert.deepEqual(ids, ["alice", "bob"]);
});

test("resolves the tool names from the profile's tools the same way a single-session entry point would", () => {
  const session = manager().get("alice", "local", "admin", "default");
  assert.deepEqual(
    session.tools.definitions().map((t) => t.name).sort(),
    ["bash", "read_file", "write_file"],
  );
});

test("a client-role session only gets its restricted tool subset - bash never shows up", () => {
  const session = manager().get("alice", "local", "client", "default");
  assert.deepEqual(
    session.tools.definitions().map((t) => t.name),
    ["read_file"],
  );
});

test("an unknown role throws instead of silently granting the full tool set", () => {
  assert.throws(() => manager().get("alice", "local", "guest", "default"), /Unknown role "guest"/);
});

test("reconnecting to an existing session with a different role throws instead of silently attaching", () => {
  const m = manager();
  m.get("alice", "local", "admin", "default");

  assert.throws(() => m.get("alice", "local", "client", "default"), /created with role "admin", got "client"/);
});

test("two profiles give independent sessions their own system prompt and tool-pack", () => {
  const m = manager({
    default: makeConfig({ systemPrompt: "default profile prompt", tools: ["read_file", "bash"] }),
    readonly: makeConfig({ systemPrompt: "readonly profile prompt", tools: ["read_file"], roles: {} }),
  });

  const admin = m.get("alice", "local", "admin", "default");
  const guest = m.get("bob", "local", "admin", "readonly");

  assert.deepEqual(admin.tools.definitions().map((t) => t.name).sort(), ["bash", "read_file"]);
  assert.deepEqual(guest.tools.definitions().map((t) => t.name), ["read_file"]);
});

test("an unknown profile propagates ProfileSource's error instead of falling back to a default", () => {
  assert.throws(() => manager().get("alice", "local", "admin", "ghost"), /no fake profile "ghost"/);
});

test("reconnecting to an existing session with a different profile throws instead of silently attaching", () => {
  const m = manager({ default: DEFAULT_CONFIG, readonly: makeConfig({ tools: ["read_file"], roles: {} }) });
  m.get("alice", "local", "admin", "default");

  assert.throws(
    () => m.get("alice", "local", "admin", "readonly"),
    /created with profile "default", got "readonly"/,
  );
});

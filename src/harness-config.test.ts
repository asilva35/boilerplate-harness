import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError } from "./errors.js";
import {
  harnessConfig,
  loadHarnessConfig,
  resolveRoleTools,
  validateRoles,
  ProfileRegistry,
  type HarnessConfig,
} from "./harness-config.js";

const COMPACTION = { strategy: "sliding" as const, keepLast: 20, tokenThreshold: 4000, summarizeThreshold: 40 };

function config(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    systemPrompt: "test",
    tools: ["read_file", "write_file", "bash"],
    compaction: COMPACTION,
    roles: {},
    subagents: {},
    ...overrides,
  };
}

test("resolveRoleTools: \"admin\" always resolves to the full tools list, roles configured or not", () => {
  const cfg = config({ roles: { client: ["read_file"] } });
  assert.deepEqual(resolveRoleTools(cfg, "admin"), cfg.tools);
  assert.deepEqual(resolveRoleTools(config(), "admin"), cfg.tools);
});

test("resolveRoleTools: a configured role resolves to its own subset", () => {
  const cfg = config({ roles: { client: ["read_file"] } });
  assert.deepEqual(resolveRoleTools(cfg, "client"), ["read_file"]);
});

test("resolveRoleTools: an unconfigured role throws ConfigError rather than falling back to full access", () => {
  const cfg = config({ roles: { client: ["read_file"] } });
  assert.throws(() => resolveRoleTools(cfg, "guest"), ConfigError);
  assert.throws(() => resolveRoleTools(config(), "client"), ConfigError); // roles is empty
});

test("validateRoles: accepts a role whose tools are a subset of the top-level tools list", () => {
  assert.doesNotThrow(() => validateRoles(config({ roles: { client: ["read_file", "bash"] } })));
});

test("validateRoles: rejects a role listing a tool absent from the top-level tools list", () => {
  assert.throws(
    () => validateRoles(config({ roles: { client: ["read_file", "delegate_research"] } })),
    /role "client" lists tool "delegate_research"/,
  );
});

test("validateRoles: rejects \"admin\" as a declared role name - it's reserved", () => {
  assert.throws(() => validateRoles(config({ roles: { admin: ["read_file"] } })), /reserved role name/);
});

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-config-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadHarnessConfig: a missing file is a ConfigError naming the exact path, not a raw ENOENT", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      async () => loadHarnessConfig(path.join(dir, "nope.config.json")),
      (err) => err instanceof ConfigError && /nope\.config\.json/.test(err.message),
    );
  });
});

test("loadHarnessConfig: malformed JSON is a ConfigError, not a raw SyntaxError", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "bad.config.json");
    await writeFile(file, "not json", "utf-8");
    await assert.rejects(async () => loadHarnessConfig(file), (err) => err instanceof ConfigError);
  });
});

test("loadHarnessConfig: a valid file parses, applies defaults, and runs the role validation", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "good.config.json");
    await writeFile(file, JSON.stringify({ systemPrompt: "hi", tools: ["read_file"] }), "utf-8");
    const loaded = loadHarnessConfig(file);
    assert.equal(loaded.systemPrompt, "hi");
    assert.deepEqual(loaded.roles, {}); // Zod default
    assert.equal(loaded.compaction.strategy, "sliding"); // Zod default
  });
});

test("loadHarnessConfig: an invalid role (caught by validateRoles) surfaces through the same load path", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "bad-role.config.json");
    await writeFile(
      file,
      JSON.stringify({ systemPrompt: "hi", tools: ["read_file"], roles: { admin: ["read_file"] } }),
      "utf-8",
    );
    await assert.rejects(async () => loadHarnessConfig(file), /reserved role name/);
  });
});

test('ProfileRegistry: "default" returns the module\'s harnessConfig singleton, never re-read', () => {
  const registry = new ProfileRegistry();
  assert.equal(registry.get("default"), harnessConfig);
});

test("ProfileRegistry: a named profile loads harness.<name>.config.json from the cwd and caches it", async () => {
  const scratchPath = path.join(process.cwd(), "harness.__unittest__.config.json");
  await writeFile(scratchPath, JSON.stringify({ systemPrompt: "scratch profile", tools: ["read_file"] }), "utf-8");
  try {
    const registry = new ProfileRegistry();
    const first = registry.get("__unittest__");
    assert.equal(first.systemPrompt, "scratch profile");

    // Second get() must be the exact same object (cached), not a fresh
    // read - deleting the file between calls proves it, since a second
    // disk read would throw.
    await unlink(scratchPath);
    const second = registry.get("__unittest__");
    assert.equal(second, first);
  } finally {
    await rm(scratchPath, { force: true });
  }
});

test("ProfileRegistry: an unconfigured profile name throws ConfigError instead of falling back to default", () => {
  const registry = new ProfileRegistry();
  assert.throws(() => registry.get("no-such-profile"), ConfigError);
});

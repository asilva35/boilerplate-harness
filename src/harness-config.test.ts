import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError } from "./errors.js";
import {
  harnessConfig,
  loadHarnessSection,
  loadProfileConfig,
  loadToolsSection,
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

test("loadHarnessSection: a missing file is a ConfigError naming the exact path, not a raw ENOENT", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      async () => loadHarnessSection(path.join(dir, "nope.config.json")),
      (err) => err instanceof ConfigError && /nope\.config\.json/.test(err.message),
    );
  });
});

test("loadHarnessSection: malformed JSON is a ConfigError, not a raw SyntaxError", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "bad.config.json");
    await writeFile(file, "not json", "utf-8");
    await assert.rejects(async () => loadHarnessSection(file), (err) => err instanceof ConfigError);
  });
});

test("loadHarnessSection: a valid file parses systemPrompt/compaction, applying Zod defaults", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "good.config.json");
    await writeFile(file, JSON.stringify({ systemPrompt: "hi" }), "utf-8");
    const loaded = loadHarnessSection(file);
    assert.equal(loaded.systemPrompt, "hi");
    assert.equal(loaded.compaction.strategy, "sliding"); // Zod default
  });
});

test("loadToolsSection: a missing file is a ConfigError naming the exact path", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      async () => loadToolsSection(path.join(dir, "nope.json")),
      (err) => err instanceof ConfigError && /nope\.json/.test(err.message),
    );
  });
});

test("loadToolsSection: a valid file parses tools and applies Zod defaults for roles/subagents", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "good.json");
    await writeFile(file, JSON.stringify({ tools: ["read_file"] }), "utf-8");
    const loaded = loadToolsSection(file);
    assert.deepEqual(loaded.tools, ["read_file"]);
    assert.deepEqual(loaded.roles, {});
    assert.deepEqual(loaded.subagents, {});
  });
});

// loadProfileConfig() resolves bare cwd-relative filenames by naming
// convention (harness.<suffix>config.json / tools.<suffix>json) - the
// same reason ProfileRegistry's own named-profile test below has to use
// scratch files in the repo root rather than an arbitrary temp dir: that
// convention IS the thing under test.
async function withScratchProfile(
  profileName: string,
  harnessBody: object,
  toolsBody: object,
  fn: () => Promise<void> | void,
): Promise<void> {
  const suffix = profileName === "default" ? "" : `${profileName}.`;
  const harnessPath = path.join(process.cwd(), `harness.${suffix}config.json`);
  const toolsPath = path.join(process.cwd(), `tools.${suffix}json`);
  await writeFile(harnessPath, JSON.stringify(harnessBody), "utf-8");
  await writeFile(toolsPath, JSON.stringify(toolsBody), "utf-8");
  try {
    await fn();
  } finally {
    await rm(harnessPath, { force: true });
    await rm(toolsPath, { force: true });
  }
}

test("loadProfileConfig: merges harness.<name>.config.json and tools.<name>.json into one HarnessConfig", async () => {
  await withScratchProfile(
    "__unittest_profile__",
    { systemPrompt: "scratch profile" },
    { tools: ["read_file", "bash"] },
    () => {
      const loaded = loadProfileConfig("__unittest_profile__");
      assert.equal(loaded.systemPrompt, "scratch profile");
      assert.deepEqual(loaded.tools, ["read_file", "bash"]);
    },
  );
});

test("loadProfileConfig: runs validateRoles on the merged result, not on either file alone", async () => {
  await withScratchProfile(
    "__unittest_badrole__",
    { systemPrompt: "scratch" },
    { tools: ["read_file"], roles: { client: ["bash"] } }, // "bash" isn't in tools
    async () => {
      await assert.rejects(async () => loadProfileConfig("__unittest_badrole__"), /role "client" lists tool "bash"/);
    },
  );
});

test('ProfileRegistry: "default" returns the module\'s harnessConfig singleton, never re-read', () => {
  const registry = new ProfileRegistry();
  assert.equal(registry.get("default"), harnessConfig);
});

test("ProfileRegistry: a named profile loads its harness.<name>.config.json + tools.<name>.json pair and caches it", async () => {
  const harnessPath = path.join(process.cwd(), "harness.__unittest__.config.json");
  const toolsPath = path.join(process.cwd(), "tools.__unittest__.json");
  await writeFile(harnessPath, JSON.stringify({ systemPrompt: "scratch profile" }), "utf-8");
  await writeFile(toolsPath, JSON.stringify({ tools: ["read_file"] }), "utf-8");
  try {
    const registry = new ProfileRegistry();
    const first = registry.get("__unittest__");
    assert.equal(first.systemPrompt, "scratch profile");
    assert.deepEqual(first.tools, ["read_file"]);

    // Second get() must be the exact same object (cached), not a fresh
    // read - deleting both files between calls proves it, since a second
    // disk read would throw.
    await unlink(harnessPath);
    await unlink(toolsPath);
    const second = registry.get("__unittest__");
    assert.equal(second, first);
  } finally {
    await rm(harnessPath, { force: true });
    await rm(toolsPath, { force: true });
  }
});

test("ProfileRegistry: an unconfigured profile name throws ConfigError instead of falling back to default", () => {
  const registry = new ProfileRegistry();
  assert.throws(() => registry.get("no-such-profile"), ConfigError);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError } from "./errors.js";
import { resolveRoleTools, validateRoles, type HarnessConfig } from "./harness-config.js";

const COMPACTION = { strategy: "sliding" as const, keepLast: 20, tokenThreshold: 4000, summarizeThreshold: 40 };

function config(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    systemPrompt: "test",
    tools: ["read_file", "write_file", "bash"],
    compaction: COMPACTION,
    roles: {},
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

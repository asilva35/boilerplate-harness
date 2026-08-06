import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SkillRegistry } from "./registry.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "skill-registry-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a missing skills directory loads as an empty registry, not an error", async () => {
  await withTempDir(async (dir) => {
    const registry = await SkillRegistry.load(path.join(dir, "does-not-exist"));
    assert.deepEqual(registry.all(), []);
  });
});

test("indexes name, trigger, and path from each skill's front-matter, without needing to load full content twice", async () => {
  await withTempDir(async (dir) => {
    await writeFile(
      path.join(dir, "a.md"),
      "---\nname: skill-a\ntrigger: doing A\n---\n\nfull body of skill a\n",
    );
    await writeFile(
      path.join(dir, "b.md"),
      "---\nname: skill-b\ntrigger: doing B\n---\n\nfull body of skill b\n",
    );

    const registry = await SkillRegistry.load(dir);
    const all = registry.all();

    assert.equal(all.length, 2);
    const byName = Object.fromEntries(all.map((s) => [s.name, s]));
    assert.equal(byName["skill-a"].trigger, "doing A");
    assert.equal(byName["skill-a"].path, path.join(dir, "a.md"));
    assert.equal(byName["skill-b"].trigger, "doing B");
  });
});

test("skips a skill file missing name or trigger instead of crashing the whole load", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "good.md"), "---\nname: good\ntrigger: something\n---\nbody\n");
    await writeFile(path.join(dir, "bad.md"), "---\nname: bad\n---\nno trigger, should be skipped\n");
    await writeFile(path.join(dir, "not-a-skill.txt"), "ignored, not a .md file\n");

    const registry = await SkillRegistry.load(dir);

    assert.equal(registry.all().length, 1);
    assert.equal(registry.all()[0].name, "good");
  });
});

test("match() finds skills whose trigger shares a significant word with the task, case-insensitively", async () => {
  const registry = new SkillRegistry([
    { name: "ts-rules", trigger: "Writing or reviewing TypeScript code", path: "unused" },
    { name: "sql-rules", trigger: "Writing SQL migrations", path: "unused" },
  ]);

  const matches = registry.match("please review this TYPESCRIPT function");

  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "ts-rules");
});

test("match() returns nothing when no trigger word overlaps the task", async () => {
  const registry = new SkillRegistry([{ name: "ts-rules", trigger: "Writing TypeScript code", path: "unused" }]);

  assert.deepEqual(registry.match("what's the weather like today"), []);
});

test("match() ignores short/common words so it doesn't over-match on noise", async () => {
  const registry = new SkillRegistry([{ name: "a-rule", trigger: "for the API of a service", path: "unused" }]);

  // Shares "for" and "the" with the trigger, but those are filtered out
  // (< 4 chars) along with "api"/"of"/"a" - "service" is the only real
  // signal word left, and the task doesn't mention it.
  assert.deepEqual(registry.match("is this for the greater good"), []);
});

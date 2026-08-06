import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockProvider } from "../provider/mock.js";
import { digestSkills } from "./digest.js";

async function withTempSkill(
  body: string,
  fn: (skillPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "digest-test-"));
  const skillPath = path.join(dir, "skill.md");
  try {
    await writeFile(skillPath, body);
    await fn(skillPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("with no matched skills, never calls the provider and returns ''", async () => {
  const provider = new MockProvider([]); // would throw if send() were called

  const digest = await digestSkills(provider, [], "any task");

  assert.equal(digest, "");
  assert.equal(provider.calls.length, 0);
});

test("sends the skill's body (front-matter stripped) and the task, returns the digested rules", async () => {
  await withTempSkill("---\nname: ts-rules\ntrigger: typescript\n---\n\nnever use any\nvalidate with zod\n", async (skillPath) => {
    const provider = new MockProvider([
      { content: [{ type: "text", text: "- never use any\n- validate with zod" }], stopReason: "end_turn" },
    ]);

    const digest = await digestSkills(provider, [{ name: "ts-rules", trigger: "typescript", path: skillPath }], "write a function");

    assert.equal(digest, "- never use any\n- validate with zod");
    assert.equal(provider.calls[0].systemPrompt, "");
    const sentText = (provider.calls[0].messages[0].content[0] as { text: string }).text;
    assert.match(sentText, /write a function/);
    assert.match(sentText, /never use any/);
    assert.doesNotMatch(sentText, /---/); // front-matter block itself isn't leaked into the prompt
  });
});

test("a missing skill file is best-effort - returns '' instead of throwing", async () => {
  const provider = new MockProvider([{ content: [{ type: "text", text: "should never be reached" }], stopReason: "end_turn" }]);

  const digest = await digestSkills(provider, [{ name: "gone", trigger: "x", path: "/nonexistent/path.md" }], "a task");

  assert.equal(digest, "");
});

test("a provider failure is best-effort - returns '' instead of throwing", async () => {
  await withTempSkill("---\nname: ts-rules\ntrigger: typescript\n---\n\nbody\n", async (skillPath) => {
    const provider = new MockProvider([]); // no scripted response - MockProvider throws

    const digest = await digestSkills(provider, [{ name: "ts-rules", trigger: "typescript", path: skillPath }], "a task");

    assert.equal(digest, "");
  });
});

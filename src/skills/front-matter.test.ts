import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontMatter } from "./front-matter.js";

test("parses a name/trigger front-matter block and separates it from the body", () => {
  const raw = "---\nname: my-skill\ntrigger: doing the thing\n---\n\nBody content here.\nMore body.\n";

  const { data, content } = parseFrontMatter(raw);

  assert.deepEqual(data, { name: "my-skill", trigger: "doing the thing" });
  assert.equal(content, "Body content here.\nMore body.");
});

test("a value containing a colon is kept intact (split only on the first colon)", () => {
  const raw = "---\ntrigger: how does X work: investigate it\n---\nbody\n";

  const { data } = parseFrontMatter(raw);

  assert.equal(data.trigger, "how does X work: investigate it");
});

test("a file with no front-matter block returns the whole thing as content, empty data", () => {
  const raw = "just a plain markdown file, no front-matter\n";

  const { data, content } = parseFrontMatter(raw);

  assert.deepEqual(data, {});
  assert.equal(content, raw);
});

test("ignores lines in the front-matter block with no colon", () => {
  const raw = "---\nname: my-skill\nnot a key-value line\ntrigger: x\n---\nbody\n";

  const { data } = parseFrontMatter(raw);

  assert.deepEqual(data, { name: "my-skill", trigger: "x" });
});

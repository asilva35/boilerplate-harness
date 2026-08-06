// Scans .harness/skills/*.md at startup and keeps a lightweight index
// (name + trigger + path) - the full content only gets read later, by
// digest.ts, for whichever skills actually match a task. A missing
// directory is not an error - it just means no skills are defined yet,
// same resilience as .harness/ for memory (Phase 16) and mcp.json being
// optional (Phase 5).

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseFrontMatter } from "./front-matter.js";
import type { SkillMeta } from "./types.js";

// How long a trigger word needs to be to count as a real signal instead of
// noise ("a", "for", "the", "in", "of", "is", "with" all get filtered out
// this way without maintaining an explicit stopword list).
const MIN_MATCH_WORD_LENGTH = 4;

export class SkillRegistry {
  constructor(private readonly skills: SkillMeta[] = []) {}

  static async load(dir = ".harness/skills"): Promise<SkillRegistry> {
    let filenames: string[];
    try {
      filenames = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new SkillRegistry([]);
      throw err;
    }

    const skills: SkillMeta[] = [];
    for (const filename of filenames) {
      const filePath = path.join(dir, filename);
      const raw = await readFile(filePath, "utf-8");
      const { data } = parseFrontMatter(raw);
      // A skill file missing name/trigger is malformed - skip it instead
      // of crashing every entry point's startup over one bad file.
      if (!data.name || !data.trigger) continue;
      skills.push({ name: data.name, trigger: data.trigger, path: filePath });
    }
    return new SkillRegistry(skills);
  }

  all(): SkillMeta[] {
    return [...this.skills];
  }

  // Cheap local heuristic, not an LLM call: a skill matches a task when any
  // significant word from its trigger shows up in the task text. Good
  // enough to shortlist candidates before the (comparatively expensive)
  // digestion step actually reads and compacts them.
  match(task: string): SkillMeta[] {
    const t = task.toLowerCase();
    return this.skills.filter((s) =>
      s.trigger
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length >= MIN_MATCH_WORD_LENGTH)
        .some((word) => t.includes(word)),
    );
  }
}

// "Digestion": given the skills a task already matched (SkillRegistry.match)
// and the task itself, asks the provider to compact them into a handful of
// concrete, actionable rules - what a subagent actually needs, instead of
// the full skill document(s) verbatim. Best-effort: no matched skills means
// no provider call at all, and a failed call just means no rules get added
// (the subagent still gets the plain task, same as if no skill applied).

import { readFile } from "node:fs/promises";
import { parseFrontMatter } from "./front-matter.js";
import type { SkillMeta } from "./types.js";
import type { Block, Provider } from "../provider/types.js";

const INSTRUCTIONS = `You are extracting the parts of these project skills relevant to a specific task.

Output 3-5 short, concrete, actionable rules as a bullet list (one per line, starting with "-").
No preamble, no explanation - just the rules. If none of the skills are actually relevant to
this task, output nothing.`;

export async function digestSkills(provider: Provider, skills: SkillMeta[], task: string): Promise<string> {
  if (skills.length === 0) return "";

  // Everything past this point is best-effort - a skill file that vanished
  // between indexing and now, or a failed provider call, should just mean
  // "no rules added," never a crash of the whole delegate call.
  try {
    const bodies = await Promise.all(
      skills.map(async (skill) => {
        const raw = await readFile(skill.path, "utf-8");
        return `# ${skill.name}\n${parseFrontMatter(raw).content}`;
      }),
    );

    const prompt = `${INSTRUCTIONS}\n\nTask: ${task}\n\nSkills:\n\n${bodies.join("\n\n")}`;
    const response = await provider.send([{ role: "user", content: [{ type: "text", text: prompt }] }], "");
    return response.content
      .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch {
    return "";
  }
}

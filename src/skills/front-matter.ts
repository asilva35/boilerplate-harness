// Deliberately hand-rolled instead of pulling in gray-matter/js-yaml: skill
// front-matter here is just a couple of flat string fields (name, trigger),
// nothing nested or multi-line - a full YAML parser would be solving a
// problem this project doesn't have.

export interface ParsedFrontMatter {
  data: Record<string, string>;
  content: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontMatter(raw: string): ParsedFrontMatter {
  const match = raw.match(FRONT_MATTER);
  if (!match) return { data: {}, content: raw };

  const [, block, content] = match;
  const data: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) data[key] = value;
  }
  return { data, content: content.trim() };
}

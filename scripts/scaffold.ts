// Phase 8: scaffolds a new harness project from this boilerplate's core.
// No Go equivalent — same spirit as `npm create vite@latest`: copy the
// reusable code as-is, then ask a few questions to generate a fresh
// harness.config.json + tools.json (Phase 24 split the latter out), instead
// of forking this repo and hand-editing three entry points to change the
// system prompt or which tools load.

import { access, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { catalogToolNames } from "../src/tools/catalog.js";

// Everything a scaffolded project needs, copied as-is. Deliberately
// excludes harness.config.json/tools.json (regenerated below from the
// prompts) and anything gitignored (.env, mcp.json, node_modules, dist)
// or repo plumbing (.git) that a fresh project shouldn't inherit.
const CORE_ENTRIES = ["src", "package.json", "tsconfig.json", ".nvmrc", ".env.example", ".gitignore", "README.md"];

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    console.error(
      "Usage: npm run scaffold -- <target-directory>\n" +
        "  e.g. npm run scaffold -- ../my-vertical-harness",
    );
    process.exit(1);
  }
  const target = path.resolve(targetArg);

  if (await exists(target)) {
    const entries = await readdir(target);
    if (entries.length > 0) {
      console.error(`Refusing to scaffold into ${target}: directory already exists and is not empty.`);
      process.exit(1);
    }
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const systemPrompt = (await rl.question("System prompt for this harness: ")).trim();
  if (!systemPrompt) {
    console.error("System prompt can't be empty.");
    rl.close();
    process.exit(1);
  }

  const tools: string[] = [];
  for (const name of catalogToolNames()) {
    const answer = await rl.question(`Enable tool "${name}"? [Y/n] `);
    if (!/^n(o)?$/i.test(answer.trim())) tools.push(name);
  }

  rl.close();

  await mkdir(target, { recursive: true });
  for (const entry of CORE_ENTRIES) {
    await cp(entry, path.join(target, entry), { recursive: true });
  }

  // Compaction isn't prompted for — sensible default matching this repo's
  // own reference harness.config.json, editable by hand afterwards like
  // any other part of the scaffolded project. roles/subagents aren't
  // prompted for either - they're opt-in refinements (Phases 21/23) on
  // top of the tool list this does ask about, left for the new project to
  // add by hand if it needs them.
  const harnessConfig = {
    systemPrompt,
    compaction: { strategy: "sliding", keepLast: 20, tokenThreshold: 4000 },
  };
  const toolsConfig = { tools };
  await writeFile(path.join(target, "harness.config.json"), JSON.stringify(harnessConfig, null, 2) + "\n");
  await writeFile(path.join(target, "tools.json"), JSON.stringify(toolsConfig, null, 2) + "\n");

  const pkgPath = path.join(target, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pkg.name = path.basename(target);
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  console.log(`\nScaffolded a new harness at ${target}\n`);
  console.log("Next steps:");
  console.log(`  cd ${path.relative(process.cwd(), target) || "."}`);
  console.log("  nvm use");
  console.log("  npm install");
  console.log("  cp .env.example .env   # and fill in your API key");
  console.log("  npm start");
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

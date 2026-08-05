// Configuration read from environment variables. Equivalent to the
// os.Getenv() calls scattered across main.go in the original Go project.

// process.loadEnvFile() needs Node >= 20.12. Fail loudly and early instead
// of silently skipping .env and surfacing a confusing "missing API key"
// error much later, once createProvider() runs.
const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 12;
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < MIN_NODE_MAJOR || (nodeMajor === MIN_NODE_MAJOR && nodeMinor < MIN_NODE_MINOR)) {
  console.error(
    `boilerplate-harness needs Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} ` +
      `(process.loadEnvFile isn't available before that). You're running Node ${process.versions.node}.\n` +
      `Run "nvm use" (see .nvmrc) or upgrade Node, then try again.`,
  );
  process.exit(1);
}

// Node 20.12+ can load a .env file natively, without depending on the
// `dotenv` package. ENOENT (no .env file) is fine — e.g. in CI, where the
// key already arrives exported in the environment — but any other error
// should surface instead of being swallowed.
try {
  process.loadEnvFile(".env");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  // Analogous to $LLM_PROVIDER / $LLM_MODEL in main.go: startup defaults,
  // an empty model lets each provider pick its own.
  llmProvider: process.env.LLM_PROVIDER || "anthropic",
  llmModel: process.env.LLM_MODEL ?? "",
  maxTokens: 8192,
} as const;

# boilerplate-harness

An educational, progressive Node.js/TypeScript boilerplate for learning **harness engineering** — the scaffolding layer around an LLM (agent loop, tools, permissions, context compaction, commands, UI) that turns it into a useful agent.

Built phase by phase, one commit per phase, so the git history itself doubles as a walkthrough: check out any commit to see the project at that exact stage.

## Requirements

- **Node.js ≥ 20**.
- An API key from **Anthropic** ([console.anthropic.com](https://console.anthropic.com)) or **OpenRouter** ([openrouter.ai](https://openrouter.ai)) — whichever you have on hand. OpenRouter is the fallback if your card isn't accepted directly by Anthropic (happens in some countries); it gives access to the same Claude models through a proxy.

## Setup

```sh
nvm use   # if you use nvm — installs/activates the version in .nvmrc
npm install
cp .env.example .env   # and fill in your API key there
```

## Run

```sh
npm start          # plain console REPL
npm run typecheck   # tsc --noEmit
```

## Phase 1: Base Config and Minimal Viable Product (REPL, no tools)

**Key concept:** understanding the basic message exchange (User/Assistant) in a conversation, with history kept in memory.

- `tsx` for direct TypeScript execution, no manual compile step.
- A `Provider` abstraction (`src/provider/`) with two interchangeable adapters (Anthropic, OpenRouter) — nothing else in the harness ever imports either SDK directly.
- A plain `while (true)` loop reading from `process.stdin` via `readline/promises`.

Try it: run `npm start` and hold a multi-turn conversation to confirm the `messages` array keeps context across turns.

More phases land here as the project grows — see the commit history for the full progression.

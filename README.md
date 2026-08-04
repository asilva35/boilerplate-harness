# boilerplate-harness

An educational, progressive Node.js/TypeScript boilerplate for learning **harness engineering** — the scaffolding layer around an LLM (agent loop, tools, permissions, context compaction, commands, UI) that turns it into a useful agent.

Built phase by phase, one commit per phase, so the git history itself doubles as a walkthrough: check out any commit to see the project at that exact stage.

## Requirements

- **Node.js ≥ 20** (needed once `@modelcontextprotocol/sdk` and `ink` are in, since they use ES2024 regex syntax not supported on Node 18).
- This repo pins **Node 22.21.0** in `.nvmrc`. If you use [nvm](https://github.com/nvm-sh/nvm):

  ```sh
  nvm install   # installs the version in .nvmrc if you don't have it
  nvm use       # activates it in this terminal
  ```

  Run `nvm use` in every new terminal before `npm run ...` — nvm doesn't switch versions on its own. If you forget, you'll see `SyntaxError: Invalid regular expression flags` on startup.

- An API key from **Anthropic** ([console.anthropic.com](https://console.anthropic.com)) or **OpenRouter** ([openrouter.ai](https://openrouter.ai)) — whichever you have on hand. OpenRouter is the fallback if your card isn't accepted directly by Anthropic (happens in some countries); it gives access to the same Claude models through a proxy.

## Setup

```sh
nvm use
npm install
cp .env.example .env   # and fill in your API key there
```

## Run

Three entry points, same session underneath (same provider, tools, MCP, Agent):

```sh
npm start      # plain console REPL — the "no magic" version to read first
npm run tui    # Ink-based TUI — input history, spinner, live [y/N] prompt
npm run web    # server + browser chat
```

Start with `npm start` if you're going through the code for the first time; it's easier to follow without the React layer on top. `npm run tui` is the more polished version.

`npm run web` starts an HTTP + WebSocket server **on `127.0.0.1` only** (never on the local network — `bash` and `write_file` must never be reachable from the outside) and serves a chat at `http://127.0.0.1:3003` (port configurable via `WEB_PORT`). It's a single, global session: every tab you open shares the same conversation, just like several windows of the same REPL.

```sh
npm run typecheck   # tsc --noEmit
```

## Commands inside a session

| Command | Effect |
|---|---|
| `/help` | List available commands |
| `/clear` | Clear the conversation history |
| `/history` | Show a summary of the message history |
| `/compact [sliding\|none]` | Run compaction now (configured strategy, or an ad-hoc one) |
| `/exit` | Exit the harness |

In `npm start`, `Ctrl+D` also exits (readline EOF). In `npm run tui`, use `/exit` or `Ctrl+D`.

## MCP (optional)

`mcp.json` (gitignored, may hold secrets) connects external servers via the [Model Context Protocol](https://modelcontextprotocol.io). Copy `mcp.example.json` as a starting point:

```sh
cp mcp.example.json mcp.json
```

Its tools show up alongside the local ones, under `"<server>_<tool>"`. By default they ask for `[y/N]` approval before running (we have no way to know upfront how risky an external server is).

## Project structure

```
src/
├── index.ts              Plain console REPL (entry point 1)
├── tui.tsx                Ink TUI REPL (entry point 2)
├── server.ts               HTTP + WebSocket server for the browser chat (entry point 3)
├── web/
│   └── index.html            Static chat frontend (HTML/CSS/JS, no build)
├── agent.ts               Agent Loop: tool-use, permissions, compaction
├── commands.ts             "/" command registry
├── config.ts               Environment variables
├── provider/                LLM abstraction layer
│   ├── types.ts               Message, Block, ToolDef, Provider interface
│   ├── anthropic.ts            Anthropic adapter
│   ├── openrouter.ts           OpenRouter adapter (OpenAI-compatible API)
│   └── index.ts                 createProvider() factory
├── tools/                    Tool registry and implementations
│   ├── types.ts                 Tool interface (Zod schema)
│   ├── registry.ts               ToolRegistry
│   ├── bash.ts / read_file.ts / write_file.ts
├── context/
│   └── compactor.ts           Compaction strategies (SlidingWindow, NoCompaction)
├── mcp/                      Model Context Protocol integration
│   ├── client.ts               MCP session wrapper (stdio / HTTP)
│   └── register.ts              Loads mcp.json and registers remote tools
└── ui/                        Ink components (spinner, input, App)
```

## Phase 1: Base Config and Minimal Viable Product (REPL, no tools)

**Key concept:** understanding the basic message exchange (User/Assistant) in a conversation, with history kept in memory.

- `tsx` for direct TypeScript execution, no manual compile step.
- A `Provider` abstraction (`src/provider/`) with two interchangeable adapters (Anthropic, OpenRouter) — nothing else in the harness ever imports either SDK directly.
- A plain `while (true)` loop reading from `process.stdin` via `readline/promises`.

Try it: run `npm start` and hold a multi-turn conversation to confirm the `messages` array keeps context across turns.

## Phase 2: Agent Loop and Basic Tool Calling

**Key concept:** the *Agent Loop* pattern. The LLM decides when to answer the user directly and when to request a local function call.

- `Tool` type and Zod schema to validate arguments (`src/tools/types.ts`).
- `read_file` and `write_file` tools using `node:fs/promises`.
- The `Agent` (`src/agent.ts`) processes `stop_reason === "tool_use"` responses: it executes the local tool and feeds the result back in a `user`-role message with `tool_result` content.

Try it: ask the agent *"Create a file called test.txt with the phrase 'Hello from my agent' and then read it back to confirm its content."*

## Phase 3: Permission Gate and Shell Command Execution

**Key concept:** safety and inspection. Controlling the execution of potentially destructive commands before they run.

- `bash` tool using `node:child_process.spawn`.
- The agent loop pauses before executing tools flagged as risky (`requiresConfirmation`) to ask for explicit `[y/N]` confirmation on the console.

Try it: ask the agent to run `ls -la` or install an npm package, and confirm the CLI pauses execution to ask for your approval.

## Phase 4: Context Management, Sliding Window, and Slash Commands

**Key concept:** handling token-limit overhead (*context window overhead*) and harness control commands.

- Intercepts input starting with `/` (`/help`, `/clear`, `/compact`, `/history`).
- A truncation/compaction strategy keeps the system prompt and the most recent messages once a token-usage threshold is crossed.

Try it: run `/compact` in the CLI and see the message array shrink without losing the essential state.

## Phase 5: Advanced Integration (MCP and Ink TUI)

**Key concept:** ecosystem and user experience. Connecting external servers via the Model Context Protocol and a richer terminal interface.

- External tools connected via `@modelcontextprotocol/sdk`.
- Migration from the plain console to interactive components with **Ink** (React for the CLI) as a second, optional entry point (`npm run tui`) — `src/index.ts` stays untouched on purpose.

Try it: copy `mcp.example.json` to `mcp.json`, run `npm run tui`, and confirm the MCP server's tools show up alongside the local ones (and ask for approval before running, same as `bash`/`write_file`).

## Phase 6: Browser Access

**Key concept:** the Agent Loop is already transport-agnostic (it receives `onToolCall`/`onAssistantText`/`confirm` as callbacks) — a fourth entry point can wire those same callbacks against a WebSocket instead of the terminal, without touching `agent.ts` at all.

- `src/server.ts`: HTTP + WebSocket server, bound exclusively to `127.0.0.1` (never to the network), single global session.
- `src/web/index.html`: a chat with bubbles, tool-call chips, and `[Yes/No]` approval, in vanilla JS with no build step.

Try it: run `npm run web`, open `http://127.0.0.1:3003`, and confirm two tabs share the same live conversation.

More phases land here as the project grows — see the commit history for the full progression.

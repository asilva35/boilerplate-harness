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

It serves the `web-app/` React + Vite + shadcn/ui build (see Phase 10 below) at `/` — build it once with `npm run web:build` (or `cd web-app && npm install && npm run build` the first time). The original no-build vanilla client from Phase 6 is still there, at `/legacy`.

```sh
npm run typecheck   # tsc --noEmit
npm test             # node:test, no API key needed
```

## Configuration

Two separate files, on purpose:

- **`.env`** — secrets: API keys, which provider/model to use. Never committed.
- **`harness.config.json`** — per-deployment behavior: system prompt, which local tools load, compaction tuning. **Committed**, like `vite.config.ts` — this is what you edit to turn this boilerplate into a different harness, instead of forking code.

```jsonc
{
  "systemPrompt": "...",
  "tools": ["read_file", "write_file", "bash"],
  "compaction": { "strategy": "sliding", "keepLast": 20, "tokenThreshold": 4000 }
}
```

`tools` names must match a key in `src/tools/catalog.ts`'s `TOOL_CATALOG`; an unknown name fails fast with a clear error instead of silently registering nothing. `compaction` is optional (defaults shown above); `"strategy": "none"` disables compaction entirely.

## Scaffolding a new harness

```sh
npm run scaffold -- ../my-vertical-harness
```

Copies the core (everything except `harness.config.json` itself) into a new directory, then asks a couple of questions — system prompt, which tools to enable — and writes a fresh `harness.config.json` from the answers. No file in *this* repo is touched.

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
harness.config.json        Per-deployment behavior: system prompt, tools, compaction (committed)
scripts/
└── scaffold.ts               Copies the core into a new project with a fresh harness.config.json
src/
├── index.ts              Plain console REPL (entry point 1)
├── tui.tsx                Ink TUI REPL (entry point 2)
├── server.ts               HTTP + WebSocket server for the browser chat (entry point 3)
├── web/
│   └── index.html            Static chat frontend (HTML/CSS/JS, no build)
├── agent.ts               Agent Loop: tool-use, permissions, compaction
├── commands.ts             "/" command registry
├── config.ts               Environment variables (secrets, provider/model selection)
├── harness-config.ts        Loads and validates harness.config.json
├── provider/                LLM abstraction layer
│   ├── types.ts               Message, Block, ToolDef, Provider interface
│   ├── anthropic.ts            Anthropic adapter
│   ├── openrouter.ts           OpenRouter adapter (OpenAI-compatible API)
│   └── index.ts                 createProvider() factory
├── tools/                    Tool registry and implementations
│   ├── types.ts                 Tool interface (Zod schema)
│   ├── registry.ts               ToolRegistry
│   ├── catalog.ts                 Name → Tool map read by harness.config.json's "tools" list
│   ├── bash.ts / read_file.ts / write_file.ts
├── context/
│   └── compactor.ts           Compaction strategies (SlidingWindow, NoCompaction, buildCompactor)
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

## Phase 7: Test Coverage, Mock Provider, and Friendly Errors

**Key concept:** the project had zero tests up to this point. `MockProvider` (a scripted `Provider` implementation) lets the `Agent` loop be exercised without a real API call — and once you're testing the loop directly, it's the right moment to also fix how it reports the *expected* failure modes a real user hits often: a missing API key, or Ctrl+C.

- `src/provider/mock.ts`: `MockProvider` returns a scripted sequence of responses and records every call it received, so tests can assert on both the `Agent`'s return value and exactly what it sent back to the provider.
- Tests (`node:test`, run via `npm test`) cover the `Agent` loop (a plain reply, a tool call round-trip, a denied confirmation, and `maxTurns` being exceeded), `ToolRegistry.execute` with malformed/invalid input, and the compaction strategies (`SlidingWindow`, `safeSplitPoint`, `estimateTokens`).
- `src/errors.ts`: a `ConfigError` class plus a shared `reportFatal()` used by all three entry points — an expected, user-actionable problem (missing API key, unknown provider) now prints one clean line instead of a full stack trace; anything else still shows the full trace, since that's what you want while debugging a real bug.
- `index.ts` and `tui.tsx` now handle Ctrl+C gracefully (closing any MCP clients and printing a `Bye!`), matching what `server.ts` already did from Phase 6.

Try it: run `npm test` (all green); then run `npm start` without an `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY` set anywhere and confirm you get one clear line telling you what to do, not a stack trace; then press Ctrl+C mid-session and confirm you get a `Bye!` instead of an abrupt kill.

## Phase 8: Boilerplate — Separating Core from Deployment Config

**Key concept:** up to this point, building a *different* harness meant forking this repo and hand-editing the system prompt and tool registration in three separate entry points. From here on, the core (agent loop, providers, tools, compaction) is separate from what varies per deployment (system prompt, which tools load, compaction tuning) — one committed JSON file, not a fork.

- `harness.config.json` (repo root, committed — see "Configuration" above): the only file a new harness needs to edit to behave differently.
- `src/harness-config.ts`: loads and validates it with Zod, throwing the same `ConfigError` (Phase 7) for a missing file or a malformed one.
- `src/tools/catalog.ts`: a name → `Tool` map (`TOOL_CATALOG`) and `registerCatalogTools()`, replacing the `tools.register(...)` calls that used to be duplicated identically in `index.ts`, `tui.tsx`, and `server.ts`.
- `src/context/compactor.ts` gains `buildCompactor()`, replacing the `new SlidingWindow(20, 4000)` that was also duplicated in all three entry points.
- `scripts/scaffold.ts` (`npm run scaffold`): copies the core into a new project and generates a fresh `harness.config.json` from a couple of prompts — same spirit as `npm create vite@latest`.

Try it: run `npm run scaffold -- ../scaffold-test`, answer with a different system prompt and say no to the `bash` tool, then in that new directory run `npm install`, `cp .env.example .env` (with your key), and `npm start` — confirm the system prompt is different, `bash` is missing from the `tools:` line printed at startup, and `git status` in *this* repo is still clean.

## Phase 9: Network Resilience (Retry/Backoff in Providers)

**Key concept:** neither original provider (Go or the TS ports so far) retries anything — a `429`, a `5xx`, or a dropped connection just aborted the whole turn. Retrying transient failures with backoff is cheap, protective, and has no equivalent to migrate from Go, since Go never had it either.

- `src/provider/retry.ts`: `withRetry(fn, { retries, baseDelayMs })`, a generic wrapper around any provider SDK call. It retries only transient errors — `429`, `5xx`, and connection failures (both SDKs represent those as an `APIError` with `status: undefined`, since no HTTP response was ever received) — and never a validation error like a `400`. When the provider sends a `Retry-After` header, that delay is used instead of the blind exponential backoff.
- `anthropic.ts` and `openrouter.ts` both wrap their `.create()` call in `withRetry()`, and construct their SDK client with `maxRetries: 0` — the SDKs have their own built-in retry logic, but disabling it keeps retry/backoff owned by one single, testable place instead of two overlapping ones.
- Tests (`src/provider/retry.test.ts`) use a fake `APIError`-shaped object (no real SDK dependency) to assert: a `429` is retried and eventually resolves, `Retry-After` is respected over the blind backoff, a `5xx` and a connection error both retry, a `400` never retries, retries run out and propagate the last error, and an unrelated error without a `status` field is left alone.

Try it: run `npm test` (all green, including the new retry tests); the practical end-to-end check is harder to trigger without a real rate limit, but `retry.test.ts` exercises the exact same `withRetry()` both providers call, using a scripted 429/5xx/connection-error sequence instead of mocking the HTTP layer directly.

## Phase 10: Web UI with React + Vite + shadcn/ui

**Key concept:** Phase 6 deliberately gave the browser client no build step — the "no magic" version to read first, same reasoning that kept `index.ts` untouched when `tui.tsx` (Ink) showed up in Phase 5. This phase adds a polished client on top **without touching the backend at all**: same WebSocket protocol (`history`, `user_text`, `assistant_text`, `text_delta`, `tool_call`, `confirm_request`, `mode`, `error`, `command_output`), a new client speaking it. It lands early on purpose — every web phase after this (multi-session, dashboard, chat history, attachments) is much easier to build on components than by hand-rolling DOM again each time.

- `web-app/`: its own Vite + React + TypeScript subproject (own `package.json`, own `node_modules`), scaffolded with `npm create vite@latest` and then `npx shadcn@latest init`. It has zero build-time dependency on the backend — `src/lib/protocol.ts` is a local copy of the wire types, not an import across the process boundary.
- `src/hooks/useHarnessSocket.ts`: one hook holding the entire client-side protocol logic — connect, rebuild the feed from `history` on (re)connect, append one item per live event, and reconnect with the same doubling backoff (capped at 10s) the Phase 6 vanilla client used.
- Components from shadcn/ui: `Badge` for the connection status, `ScrollArea` for the feed, `AlertDialog` for the Yes/No tool-approval prompt, `Textarea` (with native CSS `field-sizing: content` — no manual `scrollHeight` math needed anymore) + `Button` for the input row.
- `src/server.ts`: serves `web-app/dist` (the Vite production build) at `/`, with a small static file server (path-traversal guarded, falls back to `index.html` for unknown paths). `/legacy` still serves the original Phase 6 `src/web/index.html` unchanged, as a "no magic" reference.

Try it: `cd web-app && npm install && npm run build && cd ..` (or `npm run web:build` from the repo root), then `npm run web` and open `http://127.0.0.1:3003` — confirm the chat behaves exactly like the Phase 6 version (same history on reload, same tool-approval flow), now with shadcn/ui components; then check `http://127.0.0.1:3003/legacy` still shows the original vanilla client.

## Phase 11: Diff Preview Before Approving Writes

**Key concept:** approving a `write_file` call by reading its raw JSON input (a `path` and a wall of `content`) tells you almost nothing about what's actually about to change on disk. Showing a unified diff instead extends the Phase 3 permission gate with real context, no new gate needed.

- `src/tools/diff.ts`: `buildWriteDiff(rawInput)` parses the tool's raw JSON input, reads the target file's current contents (or treats it as empty if it doesn't exist yet — `createTwoFilesPatch` already renders that as every line added, no separate "new file" code path needed), and returns a unified diff via the `diff` npm package. Identical proposed content is reported explicitly ("no changes...") instead of returning a blank diff.
- All three entry points' `confirm` callback (`index.ts`, `App.tsx`, `server.ts`), plus the Phase 6 vanilla client at `/legacy`, show that diff instead of the raw input whenever the tool being approved is `write_file`.

Try it: ask the agent to overwrite a file that already exists, and confirm the `[y/N]` prompt (in any of the three UIs) shows `-`/`+` lines instead of the raw JSON.

## Phase 12: Streaming Responses

**Key concept:** showing the model's text as it arrives instead of waiting for the full response. Tool calls can't really stream — the JSON input has to be complete before it's valid to execute — so this only changes how text is delivered, not how tools run.

- `provider/anthropic.ts`: uses `client.messages.stream()` and its `text` event instead of `messages.create()`; `finalMessage()` still gives back the exact same shape `send()` returned before, so the rest of the harness (history, compaction) doesn't need to know streaming happened.
- `provider/openrouter.ts`: `stream: true` on `chat.completions.create`, accumulating `tool_calls` by their `index` (name and argument JSON both arrive fragmented across chunks, at different times) into the same `Block[]` shape as the non-streaming response.
- `agent.ts`: a new `onTextDelta(chunk)` callback fires per chunk; `onAssistantText(text)` is unchanged — it still fires once per finished text block, with the complete text, so history and compaction logic didn't need to change at all.
- Each entry point uses it differently: `index.ts` is nearly free (`process.stdout.write(chunk)`); `App.tsx` (Ink) accumulates chunks into a ref and flushes them into React state at most every 60ms (`STREAM_FLUSH_MS`) to avoid re-rendering the terminal on every token, clearing the live preview once `onAssistantText` confirms that block already landed in the real scrollback; the React web UI and the `/legacy` vanilla client both update the in-progress assistant bubble in place per chunk, then replace it with the authoritative full text on `assistant_text`.

Try it: ask for a long answer from the browser and watch the text grow inside the bubble progressively, instead of appearing all at once at the end.

## Phase 13: Summary Compaction (`Summarize`)

**Key concept:** `SlidingWindow` trims mechanically, discarding whatever falls outside the window. `Summarize` asks the provider itself to summarize the older turns before dropping them — controlled, readable loss of detail instead of just losing context outright.

- `src/context/compactor.ts`: `Summarize implements CompactionStrategy` (`compact` is now `async` on every strategy, `NoCompaction` and `SlidingWindow` included — the interface has to accommodate the one strategy that genuinely needs to await a network call). Once `messages.length >= threshold`, it splits at the nearest safe boundary (`safeSplitPoint`, unchanged from Phase 4), asks the provider to summarize everything before that split (`renderTranscript`, a plain-text rendering of the old messages — equivalent to Go's `api.RenderTranscript`), and replaces that whole chunk with one synthetic `"[earlier conversation summary]\n..."` message, leaving the most recent `keepRecent` messages untouched. If the provider's response has no text for some reason, it gives up and returns the history unchanged rather than losing it.
- `harness.config.json`'s `compaction.strategy` accepts `"summarize"` now, alongside `"sliding"` and `"none"`; a new `summarizeThreshold` field (message count, unlike `tokenThreshold` which is token-based and only used by `sliding`) controls when it fires. `buildCompactor()` (Phase 8) needs the provider now, since `Summarize` is the one strategy that calls out to it.
- `/compact summarize` in `commands.ts` builds a `Summarize` on the spot from the agent's own provider (`Agent.provider` is public for exactly this, same reasoning `Agent.compactor` already was) with `threshold=1, keepRecent=0` — an explicit invocation means "summarize the whole conversation now," not "wait for the configured threshold." Since this needs to `await` the provider call, `runCommand()` and every `CommandHandler` are `async` now — a change that ripples out to all three entry points, which already `await` other async work at their call sites.

Try it: have a long-ish conversation that mentions something concrete early on (a file path, a decision), run `/compact summarize`, and check `/history` — the synthetic summary message should still mention that detail even though the original message is gone.

## Phase 14: Subagents (`delegate_<name>`)

**Key concept:** delegation via tool-calling — a subagent is just another `Agent` instance, with its own system prompt, a trimmed-down tool subset, and its own turn budget, exposed to the root agent as one more callable tool.

- `src/subagent/types.ts`: the `Subagent` interface (`name`, `description`, `run(task): Promise<string>`) — same shape as a tool, but backed by its own `Agent` and context window underneath.
- `src/subagent/registry.ts`: `SubagentRegistry`, a `register()`/`all()` map analogous to `ToolRegistry`.
- `src/subagent/delegate.ts`: `delegateTool(subagent)` wraps any `Subagent` as a `Tool` named `delegate_<name>`, with a single `task` parameter. A thrown error (e.g. the subagent hitting its own `maxTurns`) isn't caught here — `ToolRegistry.execute`'s own try/catch already turns it into an error `ToolResult`, so there's no need to duplicate that.
- `src/subagent/research.ts`: the example subagent — `read_file` only (no `bash`, no `write_file`), `maxTurns: 10`, and a tight system prompt focused on investigating and answering concisely. Each `run()` builds a brand new `Agent` with a fresh `ToolRegistry` — no state carries over between calls.
- `src/tools/catalog.ts`: subagents need a `Provider` to construct, unlike the static tools, so `registerCatalogTools()` now takes the provider too and builds `delegate_<name>` tools on demand instead of keeping them in the static catalog map.

**A real bug found in the Go original, fixed here instead of ported:** Go's `Agent.System` field is set for subagents (`agent.New(r.Provider, researchSystem, r.Tools)`) but is never actually read anywhere in the codebase (confirmed with a repo-wide grep) — a subagent silently inherits whatever system prompt the shared `Provider` instance was constructed with, i.e. the root's. Since the migration guide's own entregable explicitly calls for a subagent with "su propio system prompt," this needed a real fix, not a faithful port of the bug: `Provider.send()` now takes `systemPrompt` as an explicit parameter instead of each provider reading `harnessConfig.systemPrompt` off a global singleton internally. `anthropic.ts` and `openrouter.ts` no longer import `harness-config.ts` at all. `Agent` gained a `systemPrompt` option (defaults to `""`); every entry point passes `harnessConfig.systemPrompt` for the root agent, while `ResearchSubagent` passes its own constant.

Try it: ask the root agent something that requires investigating the filesystem (e.g. "where is X handled, and what does that file look like?") and confirm in the log/UI that `delegate_research` fired as its own sub-conversation, returning only the final text to the main thread.

More phases land here as the project grows — see the commit history for the full progression.

## License

[MIT](LICENSE)

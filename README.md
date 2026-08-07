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

Three separate files, on purpose:

- **`.env`** — secrets: API keys, which provider/model to use. Never committed.
- **`harness.config.json`** — per-deployment behavior: system prompt, compaction tuning. **Committed**, like `vite.config.ts` — this is what you edit to turn this boilerplate into a different harness, instead of forking code.
- **`tools.json`** — what the harness can reach: local tools, roles (Phase 21), per-subagent tool packs and model overrides (Phases 23/26). **Committed**, analogous to `mcp.json` but for this project's own tools/subagents rather than external MCP servers (split out from `harness.config.json` in Phase 24, so registering/restricting a tool is a one-line config change here rather than editing deployment behavior).

```jsonc
// harness.config.json
{
  "systemPrompt": "...",
  "compaction": { "strategy": "sliding", "keepLast": 20, "tokenThreshold": 4000 }
}
```

```jsonc
// tools.json
{
  "tools": ["read_file", "write_file", "bash"],
  "roles": { "client": ["read_file"] },
  "subagents": { "research": ["read_file"] },
  "subagentModels": { "research": "anthropic/claude-haiku-4.5" }
}
```

`tools` names must match a key in `src/tools/catalog.ts`'s `STATIC_CATALOG` (or `delegate_<subagent>`/`remember`/`recall`); an unknown name fails fast with a clear error instead of silently registering nothing. `compaction`/`roles`/`subagents`/`subagentModels` are all optional (defaults shown above / empty); `"strategy": "none"` disables compaction entirely. `subagentModels` (Phase 26) lets a subagent run on a different model than the root agent's - a key with no entry just inherits whatever model the session's provider is already using.

Multiple deployment **profiles** (Phase 22) can coexist: `harness.readonly.config.json` + `tools.readonly.json` ship as a second example (no `bash`/`write_file` at all) - see that phase's section below for how a session picks one.

## Scaffolding a new harness

```sh
npm run scaffold -- ../my-vertical-harness
```

Copies the core (everything except `harness.config.json`/`tools.json` themselves) into a new directory, then asks a couple of questions — system prompt, which tools to enable — and writes a fresh `harness.config.json` + `tools.json` from the answers. No file in *this* repo is touched.

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
harness.config.json        Per-deployment behavior: system prompt, compaction (committed)
tools.json                  What the harness can reach: tools, roles, subagents, subagent models (committed)
scripts/
└── scaffold.ts               Copies the core into a new project with fresh harness.config.json + tools.json
src/
├── index.ts              Plain console REPL (entry point 1)
├── tui.tsx                Ink TUI REPL (entry point 2)
├── server.ts               HTTP + WebSocket server for the browser chat (entry point 3)
├── web/
│   └── index.html            Static chat frontend (HTML/CSS/JS, no build)
├── agent.ts               Agent Loop: tool-use, permissions, compaction
├── commands.ts             "/" command registry
├── debug.ts                Ring-buffer debug log (record/recordCorrelated/pair/snapshot)
├── config.ts               Environment variables (secrets, provider/model selection)
├── harness-config.ts        Loads/validates harness.config.json + tools.json, ProfileRegistry (Phase 22)
├── provider/                LLM abstraction layer
│   ├── types.ts               Message, Block, ToolDef, Provider interface
│   ├── anthropic.ts            Anthropic adapter
│   ├── openrouter.ts           OpenRouter adapter (OpenAI-compatible API)
│   └── index.ts                 createProvider() factory
├── tools/                    Tool registry and implementations
│   ├── types.ts                 Tool interface (Zod schema)
│   ├── registry.ts               ToolRegistry
│   ├── catalog.ts                 Names read from tools.json's "tools" list; buildToolPack() (Phase 23)
│   ├── bash.ts / read_file.ts / write_file.ts / estimate_scope.ts / remember.ts / recall.ts
├── context/
│   └── compactor.ts           Compaction strategies (SlidingWindow, Summarize, NoCompaction, buildCompactor)
├── subagent/                  Delegation (Phase 14): Subagent, SubagentRegistry, delegateTool, ResearchSubagent
├── memory/                    Persistent memory (Phase 16): MemoryStore, SessionFiles, NoMemory, createMemoryStore
├── skills/                    Skill registry (Phase 17): SkillRegistry, digestSkills, front-matter parsing
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

**Key concept:** Phase 6 deliberately gave the browser client no build step — the "no magic" version to read first, same reasoning that kept `index.ts` untouched when `tui.tsx` (Ink) showed up in Phase 5. This phase adds a polished client on top **without touching the backend at all**: same WebSocket protocol (`history`, `user_text`, `assistant_text`, `text_delta`, `tool_call`, `risk_flag`, `debug_event`, `confirm_request`, `mode`, `error`, `command_output`), a new client speaking it. It lands early on purpose — every web phase after this (multi-session, dashboard, chat history, attachments) is much easier to build on components than by hand-rolling DOM again each time.

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

## Phase 15: Subagent Delegation Heuristic

**Key concept:** Phase 14 gave the *mechanism* to delegate (`delegate_research` wrapping a `Subagent`) but no guidance on *when* it's worth it. The rule of thumb: a small, local change is handled inline; something spanning several files or areas of the codebase is worth investigating with a subagent first; something ambiguous or architecturally risky needs a clarifying question instead of either.

- `harness.config.json`'s `systemPrompt` documents this directly — no new mechanism needed, since the model already has `delegate_research` available from Phase 14. This is deliberately config content, not code: the guidance lives in the deployment's system prompt, the same place a forked harness would edit it for its own domain.
- `src/tools/estimate_scope.ts` (optional per the migration guide, built anyway): a lightweight, deliberately non-LLM self-check — given a task description and a guessed list of files, it counts them (deduplicated) and returns a verdict (`local` / `consider delegate_research` / `delegate_research strongly recommended, clarify if still unclear`) as a plain heuristic, not another model call. The system prompt nudges the agent to call it when it isn't sure how broad a task is, and skip it when the answer is obvious either way.

Try it: ask for a one-line fix and confirm the agent handles it directly, no `delegate_research` call. Then ask something that requires reading several unrelated files to answer, and confirm it calls `delegate_research` (optionally after `estimate_scope`) before answering, instead of reading them itself one by one.

## Phase 16: Persistent Memory Across Sessions (`remember`/`recall`)

**Key concept:** context that survives the process closing. The agent writes facts/decisions via a tool during the session; at shutdown, the session itself gets auto-summarized; and the next session starts with a preamble of recent summaries already in its system prompt - no `recall` needed just to know what happened last time.

- `src/memory/types.ts`: `MemoryStore` interface (`save`, `recall`, `preamble`) and an `Entry` shape (`time`, `kind`, `content`, `tags`).
- `src/memory/no-memory.ts`: `NoMemory`, the do-nothing default - every method succeeds with empty output, so the harness runs identically whether or not persistent memory is set up.
- `src/memory/session-files.ts`: `SessionFiles`, the default store - one markdown file per session under `.harness/sessions/`, with `.harness/index.json` as a fast-lookup layer (`recall` filters the index instead of opening every session file). `save()` only appends to an in-memory draft; nothing hits disk until `close()`, which assembles the file (grouped into Facts/Decisions/Preferences/Notes sections) and appends an index record. A session with no `save()` calls never touches disk at all.
- `src/memory/summarize-session.ts`: at shutdown, asks the model itself to summarize the whole conversation (reusing `renderTranscript` from Phase 13's `Summarize` strategy) and parses out a one-paragraph summary plus 3-5 tags. Best-effort - a failed call becomes a placeholder summary instead of blocking shutdown.
- `src/memory/index.ts`: `createMemoryStore()` (tries `SessionFiles`, falls back to `NoMemory` with a warning if `.harness/` can't be set up) and `finalizeSession()` (summarize + save + close, called once at shutdown from all three entry points instead of duplicating that sequence three times).
- `src/tools/remember.ts` / `src/tools/recall.ts`: `remember(content, kind?, tags?)` writes an entry; `recall(query, limit?)` does a case-insensitive substring search across session summaries and tags.
- Each entry point's system prompt becomes `harnessConfig.systemPrompt + await memoryStore.preamble()` at startup, and calls `finalizeSession()` in its shutdown path (`cleanup()` in `index.ts`/`tui.tsx`, the `SIGINT` handler in `server.ts`, since the web entry point's "one global session" model from Phase 6 already treats the whole server run as a single conversation).

Try it: ask the agent to remember a preference, close the session (Ctrl+C or Ctrl+D), start it again, and check the system prompt already includes it under "Recent sessions" without asking for `recall` explicitly.

## Phase 17: Skill Registry and Skill Digestion

**Key concept:** an idea from Alan Buscaglia's "20 Agent Harnesses" video, not from the Go original - an index of "skills" (reusable knowledge: project conventions, domain checklists, business rules) the agent can discover, and instead of handing a subagent the full document, a "digestion" step compacts it into a handful of concrete, actionable rules for the specific task at hand.

- `src/skills/front-matter.ts`: a small hand-rolled parser (no `gray-matter`/`js-yaml` dependency - skill front-matter here is two flat string fields, nothing a full YAML parser is needed for) that splits a `.md` file into its `---`-delimited front-matter and body.
- `src/skills/registry.ts`: `SkillRegistry.load(".harness/skills")` scans that directory at startup and keeps a lightweight index (`name`, `trigger`, `path`) - the full content isn't read yet. A missing directory loads as an empty registry, not an error, same resilience as `.harness/` for memory (Phase 16) and `mcp.json` being optional (Phase 5). `match(task)` is a cheap local heuristic (does a significant word from a skill's `trigger` show up in the task text?), not an LLM call - it just shortlists candidates before the more expensive digestion step.
- `src/skills/digest.ts`: `digestSkills(provider, matchedSkills, task)` reads the full body of whatever skills already matched and asks the provider to compact them into 3-5 concrete rules for that specific task. Best-effort throughout: zero matched skills means zero provider calls, and a failed read or provider call just means no rules get added - the subagent still gets the plain task, same as if nothing had matched.
- `src/subagent/delegate.ts`: `delegateTool()` now digests before delegating - the subagent's `task` string arrives with `\n\nRelevant project rules:\n<digest>` appended when something matched, and unchanged otherwise. The `Subagent` interface itself doesn't change - it still only ever sees a `task: string`, never a raw skill document.
- `.harness/skills/typescript-strict-types.md`: the example skill from the migration guide's practical test (never use `any`, validate with Zod at trust boundaries, etc.). Unlike `.harness/sessions/` (Phase 16, gitignored - session content is user-specific), `.harness/skills/` is meant to be committed - it's project knowledge, not runtime state, so `.gitignore` was narrowed to just the memory paths.

Try it: ask the root agent to delegate a TypeScript-related task to `delegate_research` (or anything that naturally routes there per the Phase 15 heuristic) and check the delegated task the subagent received - it should include the digested `typescript-strict-types` rules as a short bullet list, not the whole skill file.

## Phase 18: Structured Result Contracts

**Key concept:** another idea from Alan Buscaglia's video, not the Go original - a `ToolResult` today is just `{ result: string, isError: boolean }`, which is enough for simple tools but means a subagent that finds something concerning has no way to say so except burying it in prose the root might paraphrase away.

- `src/tools/types.ts`: `ToolResult` gains two optional fields, additive and backward-compatible - `risk?: "none" | "low" | "high"` and `nextRecommended?: string`. No tool is required to fill them in.
- `src/subagent/types.ts`: `Subagent.run()` now returns a `SubagentResult` (`text`, `risk?`, `nextRecommended?`) instead of a plain string, so a subagent can report the same envelope a `ToolResult` does.
- `src/subagent/research.ts`: the subagent's own system prompt asks it to end every answer with `RISK: none|low|high` and `NEXT: <suggestion or "none">`, parsed back out of the plain text response - the same "structured signal via a text convention" approach `summarizeSession` (Phase 16) already uses for its `TAGS:` line, since a single `agent.send()` call has no other side channel to report through.
- `src/subagent/delegate.ts`: `delegateTool()` maps the subagent's `risk`/`nextRecommended` straight into the `ToolResult` it returns.
- `src/agent.ts`: the loop reads `risk` off every tool result. `risk: "none"` (by far the common case) is silent - firing on every call would bury the signal it's meant to surface. `"low"`/`"high"` do two things: fire a new `onRiskFlag(toolName, risk, nextRecommended)` callback (wired to something visually distinct in every entry point, see below), and prefix the text sent back to the model with `[risk: ...]` so the root agent's own reasoning can react to it too - same "inform via context instead of hardcoding control flow" approach the Phase 15 delegation heuristic already relies on.
- Visibility per entry point: `index.ts`/`tui.tsx` print a `⚠ [name] risk: ...` line; `server.ts` broadcasts a new `risk_flag` protocol message; the React UI and the `/legacy` vanilla client both render it as a full-width banner (amber for `low`, destructive-red for `high`) instead of the small chip a routine tool call gets - the whole point is that it must not read as just another line to skim past.

Try it: ask the root agent to have `delegate_research` investigate a file with something an actual reviewer would flag - a hardcoded credential works well - and confirm the risk shows up as its own distinct banner/line in whichever UI you're using, not just somewhere inside the assistant's prose.

## Phase 19: Ring-Buffer Debug Log (`/debug`)

**Key concept:** internal observability - a correlated (request↔response) ring buffer of events, so you can inspect exactly what went to the provider or what a tool returned, without cluttering the actual conversation with the model.

- `src/debug.ts`: a 500-event ring buffer (`record`/`recordCorrelated`, `pair`, `snapshot`, `clear`, `findById`, `latest`). A module-level singleton, deliberately - the same call Go's `internal/debug/debug.go` makes and for the same reason: this is read from deep inside `agent.ts` and both providers, several layers away from where entry points wire up explicit dependencies like `Provider`/`MemoryStore`/`SkillRegistry`. When disabled (the default), `record()` short-circuits to one boolean check - no allocation, no cost. Simplification vs Go: no `Recordf`/`Recordfc` printf variants - JS already has template literals, so callers interpolate inline instead of a separate printf-style helper.
- Call sites: `provider/anthropic.ts` and `provider/openrouter.ts` record one request/response pair per `send()` call (not per internal retry attempt - a flaky connection that retries twice doesn't spam the ring with near-identical entries), with the full request/response JSON as the payload. `agent.ts` records a request/response pair per tool call (a denial becomes a `warn` event instead), and a `compact` event whenever compaction actually changes the message count, with the before/after transcript as payload.
- `/debug [on|off|clear|ls|show [id]]` in `commands.ts` - same verbs as Go's `cmdDebug`. Being a regular slash command, it already works in all three entry points for free through the existing `command_output` plumbing (Phase 6/10), no extra wiring needed for the core practical test.
- `server.ts` also broadcasts a `debug_event` message (via `debug.ts`'s `setSink`) for every event recorded while enabled, and the React UI has a full debug panel (`DebugPanel.tsx`, toggled from the header) that lists them live and expands to show the payload - a slide-over, not a modal, so you can keep triggering tool calls while watching it.

Try it: `/debug on`, trigger a tool call, then `/debug show` (defaults to the latest event with a payload) to see the raw JSON that went to the provider - in the browser, open the Debug panel first and watch the same events arrive live.

## Phase 20: Multi-Session and Multi-User (Web)

**Key concept:** Phase 6 deliberately assumed a single global session - every browser tab shared the exact same `Agent`, like several terminals attached to the same REPL. This phase replaces that with N independent conversations, a prerequisite for almost everything that follows (per-user dashboards, chat history, roles). No equivalent in the Go original - it's a single-process CLI with no notion of concurrent sessions.

- `src/session/manager.ts`: `SessionManager` holds a `sessionId → Session` map instead of the one global `Agent` `server.ts` used to build at startup. Each `Session` gets its own `Agent`/`ToolRegistry`/compactor/socket set/pending-approval slot, built on first access and reused after that - but shares the process-wide resources that are either expensive to create or genuinely stateless anyway: `Provider`, the memory `Store`, `SkillRegistry`, and already-connected MCP clients.
- `src/mcp/register.ts` split in two: `connectMCPServers()` dials every configured server and lists its tools once at startup; `registerMCPTools()` is pure, I/O-free registration into any `ToolRegistry` - so a new session can get MCP tools without redialing a stdio subprocess (or reconnecting an http server) per conversation. `registerMCPServers()` (connect+register combined) stays as-is for `index.ts`/`tui.tsx`, which only ever need one session.
- `server.ts`'s WebSocket handshake reads `?session=<id>` (identifies or creates a conversation) and `?user=<id>` (a separate, deliberately loose identifier - real auth doesn't land until Phase 33's tokens; a user can hold several sessions, so it isn't folded into `sessionId`). Several tabs opening the same `?session=` still share one conversation, exactly like Phase 6; different ids no longer step on each other. Debug events (Phase 19) stay global across every connected socket regardless of session - `debug.ts` is a process-wide singleton with no notion of which conversation triggered a given event.
- Both web clients (`web-app/src/hooks/useHarnessSocket.ts` and `src/web/index.html`) generate a session id via `crypto.randomUUID()` if the URL doesn't already carry one, and write it back with `history.replaceState` - so a reconnect (the existing backoff loop) or a plain page refresh lands back on the same conversation instead of silently starting a new one.
- `src/memory/index.ts` gains `finalizeSessions()` (plural) alongside the existing `finalizeSession()`: with N concurrent conversations, shutdown now summarizes each non-empty one into its own `SessionSummary` entry before closing the store once. That surfaced a real bug in `src/memory/session-files.ts`'s `assembleSession()`, written back when exactly one summary per process was a safe assumption: with more than one `SessionSummary` entry in the draft, the last one silently overwrote the others. Fixed to accumulate and render every summary (joined in the index, bulleted in the file body) instead of dropping all but the last.

Try it: open two URLs with different `?session=` values and confirm they're independent conversations; open two tabs with the same `?session=` and confirm they still share one, like Phase 6.

## Phase 21: Roles and Permissions per User

**Key concept:** multi-user without roles is just "more than one token" - what matters is that an end-user (`client`) gets a different subset of tools/approvals than an admin. No equivalent in the Go original.

- `harness-config.ts`: `harnessConfig.roles` is an optional `Record<string, string[]>` (default `{}`) - each key names a role, its value the subset of the top-level `tools` list that role gets. Opt-in: an empty map means every session gets the full `tools` list, identical to pre-Phase-21 behavior. `"admin"` is reserved and always resolves to the full `tools` list - declaring it in `roles` is a config error, since it almost certainly means something else was intended. `resolveRoleTools(config, role)` does the resolution and throws a `ConfigError` for any role that isn't `"admin"` and isn't a key in `roles` - an unrecognized role fails closed, it never falls back to full access.
- `src/session/manager.ts`: `SessionManager.get()`/`create()` now take a `role` alongside `sessionId`/`userId`. `Session.role` is fixed at creation - the `ToolRegistry` is one shared object for every socket attached to that session, so there's no such thing as two sockets on the same session seeing different tools. A reconnect to an existing session claiming a *different* role than it was created with is rejected outright rather than silently attached with the original role. MCP tools (`mcp.json`) stay outside role gating for now - they're a separate opt-in mechanism and every MCP tool already requires approval unconditionally (Phase 5); gating them per role is real scope, deferred.
- `server.ts`'s WebSocket handshake reads `?role=<role>`, defaulting to `"admin"` - same "no real auth yet" caveat as `?user=` from Phase 20 (real tokens land in Phase 33). An unknown role, or a role that mismatches an already-open session, gets a single `{type:"error"}` message and the socket is closed - it never takes down the rest of the server.
- `harness.config.json` ships a `client` role example (`read_file`, `delegate_research`, `estimate_scope`, `recall` - no `bash`, `write_file`, or `remember`) so the practical test below works against the repo as committed.

Try it: connect with `?role=client` and confirm the model has no `bash` tool available at all (not merely one that asks for approval) - it isn't in `tools.definitions()`, so the model can't even attempt to call it.

## Phase 22: Profile Isolation

**Key concept:** every session used to share the one `harnessConfig` singleton loaded at process startup - same system prompt, same tool-pack, same compaction settings, no matter which session it was. This phase lets a session resolve its own effective `harness.config.json` instead, relevant now that real multi-session (Phase 20) exists. No equivalent in the Go original.

- `harness-config.ts`: `load()` generalized into `loadHarnessConfig(path)`, taking any file path instead of always `"harness.config.json"` - the parse/validate/role-check logic doesn't change, only what file it reads. The `harnessConfig` singleton (used by `index.ts`/`tui.tsx`, which only ever need one config) is unchanged, just now expressed as `loadHarnessConfig("harness.config.json")`.
- `ProfileRegistry`: resolves a **profile name** to a `HarnessConfig`, lazily and cached - `"default"` reuses the `harnessConfig` singleton (no double read), any other name `p` loads `harness.<p>.config.json` from the working directory the first time it's asked for and returns the same object on every later call. A profile file that doesn't exist throws the same `ConfigError` `loadHarnessConfig` would.
- `src/session/manager.ts`: `SessionManager.get()`/`create()` now also take a `profile` alongside `sessionId`/`role`. A session resolves its `ToolRegistry` (role-filtered, Phase 21) and `Agent`'s `systemPrompt`/compactor from that profile's own config - the Phase 16 memory preamble (recent-session summaries) is appended on top regardless of profile, since it's about past conversations, not which deployment config is active. `Session.profile` is fixed at creation for the same reason `role` is (Phase 21): the `Agent`/`ToolRegistry` are one shared object per session. A reconnect claiming a different profile than the session was created with is rejected, same as a role mismatch. `SessionManagerOptions.profiles` is typed as the structural `ProfileSource` interface (not the concrete `ProfileRegistry` class), so tests can supply an in-memory fake instead of reading real config files off disk.
- `server.ts`'s WebSocket handshake reads `?profile=<name>`, defaulting to `"default"` - same opt-in philosophy as `?role=`.
- `harness.readonly.config.json`: a second example profile shipped in the repo - no `bash`/`write_file` in its tool-pack at all (not merely role-restricted within the default profile) and its own system prompt explaining it can't write or execute anything, so the practical test below works against the repo as committed.

Try it: open two concurrent sessions, one with no `?profile=` (or `?profile=default`) and one with `?profile=readonly` - confirm the first has `bash` and the second doesn't, and that neither's tool-pack or system prompt leaks into the other.

## Phase 23: Capability Management per Context

**Key concept:** refines Phase 14 - today `research`'s tool pack (`read_file` only) is hardcoded in `ResearchSubagent`'s own code. This phase formalizes it as configuration: which tools/MCPs a *particular subagent* gets, not just which tools a deployment has overall (that's Phases 8/21/22). Idea from Alan Buscaglia's video, which calls this capability management, distinct from just "install the MCP server." No equivalent in the Go original.

A note on the guide itself: its Phase 23 text says it extends "`tools.json` (Phase 24)" - but Phase 24 (tool-packs as their own config file) hasn't been built yet, it comes right after. That looks like a leftover cross-reference from the Session 7 phase reordering that didn't get updated when the two swapped positions. Asked Eloy how to resolve it before writing any code: extend the config that already exists (`harness.config.json`, Phase 8) now, and revisit whether it's worth its own file when Phase 24 actually lands, rather than building Phase 24 out of order to match the guide's literal (and likely stale) wording.

- `harness-config.ts`: `harnessConfig.subagents` is an optional `Record<string, string[]>` (default `{}`), parallel to `roles` - each key names a subagent, its value the tool names it gets. Not validated at config-load time the way `roles` is against `tools`: a subagent's tool pack can legitimately name an MCP tool, and MCP servers aren't connected yet when the config file is parsed (that's later, async, in each entry point's `main()`).
- `tools/catalog.ts`: `buildToolPack(names, connectedMCP)` resolves a list of names into a fresh `ToolRegistry`, sourced from either `STATIC_CATALOG` or an already-connected MCP server's tools - the same pool a deployment's own tools draw from, minus `delegate_*`/`remember`/`recall` (a subagent delegating to itself or touching memory isn't a supported case). An unresolvable name throws `ConfigError` at the point a subagent is actually built, the same fail-closed spirit as Phase 21's `resolveRoleTools`. `DEFAULT_SUBAGENT_TOOLS` (`research: ["read_file"]`) preserves the exact pre-Phase-23 behavior for any deployment that doesn't configure `subagents` at all.
- `src/subagent/research.ts`: `ResearchSubagent` now takes a pre-built `ToolRegistry` in its constructor instead of hardcoding `read_file` inside `run()` - the registry itself is stateless and reused across calls, only the `Agent`'s conversation history is still rebuilt fresh every `run()`.
- `ToolRegistry` gains `get(name)`, so `buildToolPack()` can pull a specific already-wrapped MCP tool out of a throwaway registry built via the existing `registerMCPTools()`, instead of duplicating how an MCP tool gets constructed.
- Ordering fix in `index.ts`/`tui.tsx`: both used to call `registerCatalogTools()` *before* connecting to MCP servers, so a subagent built there could never see an MCP tool even if configured to use one. Reordered to connect MCP first (mirrors what `SessionManager`/`server.ts` already did since Phase 20) - `registerMCPServers()` (connect+register combined) stayed as the convenience wrapper it's always been, these two entry points now call the split `connectMCPServers()` + `registerMCPTools()` around `registerCatalogTools()` instead.

Try it: with a real MCP filesystem server connected (`mcp.json` per `mcp.example.json`), set `"subagents": { "research": ["filesystem_read_text_file"] }` in `tools.json` (Phase 24 moved this field here from `harness.config.json` - no `read_file`, no `bash`) and ask the root agent to delegate a file-lookup task - `research` reads the file entirely through the MCP tool, never touching the local `read_file`/`bash` tools, with zero code changes.

## Phase 24: Tool-Packs Configurable per Vertical

**Key concept:** the set of tools a deployment loads should be configuration, not code registered by hand in each entry point - same spirit as `mcp.json`, but for this project's own tools/subagents.

Another note on the guide, same kind as Phase 23's: its Phase 24 text describes registering tools by hand in code (`tools.register(bashTool)`, etc.) as today's problem - but that was already solved by Phase 8, which put the tool list in `harness.config.json` and had every entry point call `registerCatalogTools()` against it instead of hardcoding. Phase 8's own text even says it stores "a reference to `tools.json` (Phase 24)" - the original plan was clearly a two-file split from the start, but what actually shipped in Phase 8 kept the tools list *inline*. So Phase 24, as literally written, was already functionally satisfied - just not in the shape (a separate file) it originally called for. Asked Eloy how to resolve it before writing code: do the literal split anyway, for the file-naming symmetry with `mcp.json` and because a smaller `harness.config.json` (just system prompt + compaction) reads more clearly as "behavior" separate from "capabilities."

- `harness-config.ts`: the single `harnessConfigSchema` split into two Zod schemas - `harnessConfigSchema` (`systemPrompt`, `compaction`) and `toolsConfigSchema` (`tools`, `roles`, `subagents`). The exported `HarnessConfig` type is their **intersection** - the exact same merged shape every consumer (`resolveRoleTools`, `SessionManager`, `tools/catalog.ts`, tests) already worked with, so nothing downstream of loading needed to change, only how a config gets assembled.
- `loadHarnessSection(path)` / `loadToolsSection(path)` parse each file in isolation. `loadProfileConfig(profileName)` ties them together by the same naming convention Phase 22 already established for the harness half: `"default"` → bare `harness.config.json` + `tools.json`; any other profile `p` → `harness.p.config.json` + `tools.p.json`. It merges both, then runs `validateRoles()` on the combined result (roles are checked against `tools`, and both now live in the same file, but validation stays a single call site on the merged shape rather than duplicated per section). Replaces the old single-file `loadHarnessConfig(path)`.
- `ProfileRegistry` got simpler, not more complex: it no longer builds file paths itself, just delegates to `loadProfileConfig(name)` and caches the result - the profile-name-to-filenames convention now lives in exactly one place.
- Committed files: `harness.config.json` now holds only `systemPrompt`/`compaction`; `tools.json` (new) holds `tools`/`roles`/`subagents`. `harness.readonly.config.json` + `tools.readonly.json` (new) mirror the same split for the Phase 22 example profile.
- `scripts/scaffold.ts` writes both files from the same prompts as before (system prompt, which tools to enable) - `roles`/`subagents` aren't prompted for, left as opt-in refinements for the new project to hand-edit if it needs them.

Try it: edit `tools.json` to drop `"bash"` and `"write_file"` from the `tools` array (read-only tools only) and confirm the model starts without either one available - no `.ts` file touched, matching the guide's practical test exactly.

## Phase 25: Token Usage, Estimated Cost, and Runtime Provider/Model Switching

**Key concept:** how much a session is spending (tokens and USD), and switching provider/model without restarting the process. Unlike several phases in this block, **this one does exist in the Go original** and hadn't been migrated yet.

A real architectural question this phase forced, resolved with Eloy before writing code: `Provider` had been a single instance shared across every `SessionManager` session since Phase 20, safe only because it was stateless. This phase gives it real state - cumulative usage and a mutable model - so sharing it would mean `/tokens` showing every session's combined spend, and `/model`/`/provider` changing the model for every concurrent conversation at once. Chosen: **each session gets its own `Provider` instance** - `getTotalUsage()`/`estimatedCostUSD()` are scoped per-conversation, and `/model`/`/provider` only ever affect the session that ran them.

- `provider/types.ts`: `Usage` (`inputTokens`/`outputTokens`/`cachedTokens`). `Provider` gains `kind` (so `commands.ts` can display which backend is active without importing concrete provider classes - Go does the equivalent with a type switch in `ProviderKind()`), `setModel()`, `getTotalUsage()`, `estimatedCostUSD()` (`-1` = no rate known for the current model).
- `AnthropicProvider`: accumulates `input_tokens`/`output_tokens` off `response.usage` after every call (previously read and discarded). `estimatedCostUSD()` looks up a hand-maintained `ANTHROPIC_PRICING` table, same approach as Go's `modelPricing` - Anthropic's API doesn't report cost back. `cachedTokens` stays `0`: the installed SDK version doesn't implement `cache_control`, so there's nothing to report.
- `OpenRouterProvider`: verified live against the real API before writing any code - requesting `stream_options: { include_usage: true }` (the standard OpenAI streaming flag) makes OpenRouter's final chunk include its own extension: real prompt/completion tokens, `prompt_tokens_details.cached_tokens`, and - the useful part - an actual `cost` in USD, computed server-side from whichever underlying model handled the request. No hand-maintained pricing table needed here at all: `estimatedCostUSD()` just sums the real reported cost, which is more accurate than a table could be for a proxy that routes to dozens of different backends under one API.
- `MockProvider`: `kind: "mock"`, a fixed test-only rate table, and an optional `usage` field on a scripted `MockResponse` so `commands.test.ts` can exercise `/tokens` output deterministically.
- `commands.ts`: `/tokens` (usage + cost, cache line only shown when non-zero), `/model [name]` (mutates the *existing* provider's model in place - every other reference to that same object, including subagent tool wiring, sees the change on its next call, no staleness), `/provider [name] [model]` (swaps the whole backend - see below). `CommandContext` gains a required `switchProvider(name, model?)` each entry point implements.
- `tools/catalog.ts`'s `refreshSubagentTools()`: the real reason `/provider` isn't just `agent.provider = newProvider`. `delegate_research`'s `ResearchSubagent` (and its skill-digestion call, Phase 17) captured a `Provider` reference at construction (Phase 14/23) - swapping `agent.provider` alone would leave it talking to the old backend forever. `refreshSubagentTools()` re-registers only the `delegate_*` tools **already present** in a session's `ToolRegistry`, bound to the new provider - mirrors Go's `switchProvider()` calling `registerSubagents(p)` again, without expanding what a session can do. Deliberately does **not** rebuild the compaction strategy: `Summarize` (Phase 13) also captures a provider reference at construction, and Go's own `switchProvider()` doesn't touch its compactor either - a faithfully-ported limitation, not an oversight.
- `session/manager.ts`: `SessionManagerOptions.createProvider` is now a `(name?, model?) => Provider` factory - the exact signature of `provider/index.ts`'s real `createProvider()` (production passes that function directly; tests inject a fake that skips real API-key checks). Called with no args once per new session, and again with explicit args from `Session.switchProvider()` for `/provider`. `memory/index.ts`'s `finalizeSessions()` now takes each session's own provider alongside its messages, instead of one shared provider for every summary - summarizing session A must use session A's actual backend/model.
- `createProvider()`'s existing `ConfigError` (unknown provider name, missing API key) does double duty for `/provider`: it fails at switch time with a clear message, instead of Go's looser "switch anyway, warn, fail on the next call."

Try it: run a couple of turns, then `/tokens` to see real input/output/cost; `/model claude-opus-4-6` and confirm the next call uses it; `/provider openrouter <model>` (or `anthropic`, if that key has credit) and confirm both the root agent and a delegated subagent call go through the new backend.

## Phase 26: Model Routing per Subagent

**Key concept:** not every task needs the root agent's model - `research` (Phase 14) is a read-only investigation loop that can run on something cheaper/faster, configured per subagent rather than hardcoded. No Go module to migrate: this extends Phase 25's per-session `Provider`, which Go never had either.

Another guide-vs-reality note, same kind as Phases 23/24: the guide's own text says to document this "in `harness.config.json` (Phase 8)" - but since Phase 24 split subagent config (`subagents`, per-subagent tool packs) out into `tools.json`, putting the model override in a different file would split one subagent's configuration (which tools it gets, which model it runs on) across two places. Asked Eloy before writing code: keep it in `tools.json`, next to `subagents` - he agreed.

- `harness-config.ts`: `tools.json` gains `subagentModels`, an optional `Record<string, string>` (default `{}`) mapping subagent name → model id. Not validated at config-load time, same reasoning as `subagents`: a value here is meaningless without knowing which subagents exist, and that's a runtime concern, not something to enforce while parsing JSON.
- `subagent/research.ts`: `ResearchSubagent` takes an optional third constructor argument, `model?: string`. The tricky part isn't reading it - it's that `this.provider` is the **same instance** the root `Agent` uses (Phase 25 made `Provider.model` a mutable field read at `send()` time, not a constructor argument), so setting it for the subagent's call really does affect a shared object. `run()` snapshots the provider's current model, switches to the override for its `agent.send()` call, and restores the original in a `finally` - so even a subagent run that throws (e.g. "max turns reached") can't leave the shared provider permanently pointed at the wrong model. Safe because tool calls within a session already run sequentially (`Agent.loop` awaits each one before the next), never concurrently against the same provider.
- `tools/catalog.ts`: `registerSubagents()`, `registerCatalogTools()`, and `refreshSubagentTools()` all gain an optional `subagentModels` parameter (default `{}`), threaded down to `new ResearchSubagent(provider, tools, subagentModels.research)`. `refreshSubagentTools()` (Phase 25's `/provider` support) passes it through too, so a model override survives a mid-session backend swap.
- `provider/mock.ts`: `MockProvider.calls` now also records `model` (the provider's model *at the moment of that call*, not read live afterward) - needed to assert which model a given `send()` actually used, especially with a subagent temporarily switching it mid-session.
- Committed: `tools.json` sets `"subagentModels": { "research": "anthropic/claude-haiku-4.5" }` as a working example against the default OpenRouter deployment.

Try it: with the committed `tools.json`, ask the root agent a question that triggers `delegate_research`, then `/debug` - the subagent's `provider.send` events show `model=anthropic/claude-haiku-4.5` while the root agent's own calls before and after it still show `anthropic/claude-sonnet-4.6`, confirming both that the override took effect and that it didn't leak into the rest of the session.

## Phase 27: Usage Dashboard — Web and CLI

**Key concept:** a visual surface over data Phase 25 (tokens, cost, model) and Phase 20 (multi-session) already collect but never aggregate anywhere - how much every session has spent, on what model, and what it last said. No Go module to migrate: Go is a single-process, single-conversation CLI with no notion of "every session" to survey.

Before writing code, a real fork: the guide's text says "a `/dashboard` view," which could mean a client-side URL route or, following the precedent `DebugPanel.tsx` (Phase 19) already set, a toggled overlay panel with no router at all. Asked Eloy which to build: **a real `/dashboard` route** - `react-router-dom` (new dependency) instead of the DebugPanel precedent.

- `messages.ts` (new): `summarizeBlock`/`truncate`/`lastMessagePreview`, factored out of `commands.ts`'s `/history` so `session/manager.ts` could reuse the same "render a message compactly" logic for a session's last-message preview without the session layer importing the command layer.
- `session/manager.ts`: `SessionSummary` (id/userId/role/profile/kind/model/usage/estimatedCostUSD/lastMessage) and `summarizeSession(session)`, the single source of truth both surfaces below read from - so the web dashboard and the CLI can't drift on what "a session's stats" means.
- `server.ts`: `GET /api/sessions` returns `sessionManager.all().map(summarizeSession)` as JSON - a plain snapshot fetch, not pushed over the WebSocket like everything else, since a dashboard read is "give me the numbers right now," not something worth streaming incrementally.
- `commands.ts`: new `/stats` command, `CommandContext` gains an optional `listSessions?: () => SessionSummary[]`. Only `server.ts` (the one entry point that ever holds more than one session via `SessionManager`) supplies it; `index.ts`/`tui.tsx` are always exactly one `Agent`, so they omit it and `/stats` falls back to the exact same output as `/tokens`. With it, `/stats` lists every session the process currently holds - not just the one that ran the command - since it's meant as an overview, while `/tokens` stays "my own numbers."
- `web-app/`: `react-router-dom` added; `main.tsx` wraps the app in `BrowserRouter`; `App.tsx` is now a two-route `<Routes>` shell instead of the page itself. The former `App.tsx` body moved unchanged into `components/ChatPage.tsx` (`/`), plus a new "Dashboard" nav link in its header. New `components/DashboardPage.tsx` (`/dashboard`): fetches `/api/sessions` on mount and on a manual "Refresh" button, renders a plain table (session, user/role/profile, model, tokens, cost, last message) - no new UI-kit dependency, matching what the table needed. `server.ts`'s existing SPA fallback (its own Phase 10 comment already anticipated "if one gets added later") serves `index.html` for `/dashboard` with zero server changes.

**Verified for real, not just typechecked:** backend - 193 tests, `npm run build` (web-app) clean. Then a live smoke test: `server.ts` started on a scratch port, two real WebSocket sessions (`admin`/`default` and `client`/`default`) each sent a real message through OpenRouter, then `GET /api/sessions` confirmed independent, correct `usage`/`estimatedCostUSD`/`role`/`lastMessage` per session, and a plain `GET /dashboard` confirmed the SPA fallback serves `index.html` for the new client-side route. **Not verified this session:** the dashboard actually rendering/refreshing in a real browser - no browser automation tool was available this session (the user was mid-install of the Claude in Chrome extension and chose to continue without it). Eloy should open `/dashboard` himself once `web-app` is running to confirm the table renders and Refresh/nav links work as expected.

Try it: open two browser tabs with different `?session=` ids (or just chat normally in one), send a few messages, then visit `/dashboard` and confirm the numbers match what `/tokens` reports in each tab's own session.

More phases land here as the project grows — see the commit history for the full progression.

## License

[MIT](LICENSE)

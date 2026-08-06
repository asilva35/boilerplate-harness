// Reduced equivalent of commands.go: a name → handler registry for lines
// starting with "/". runCommand() returns true if the line was a command
// (handled or unrecognized) and false if it should pass through to the
// model as a normal message — same contract as Go's runCommand().

import { NoCompaction, SlidingWindow, Summarize } from "./context/compactor.js";
import { clear as clearDebugLog, findById, isEnabled, latest, setEnabled, snapshot } from "./debug.js";
import type { DebugEvent } from "./debug.js";
import type { Agent } from "./agent.js";
import type { Block } from "./provider/types.js";

export interface CommandContext {
  agent: Agent;
  // Command output used to just be console.log()'d directly - fine for
  // index.ts (stdout) and tui.tsx (Ink intercepts console.log and prints
  // it above the live UI), but server.ts's console.log never reaches the
  // browser: it just prints on the machine running the server. Routing
  // output through this callback lets each entry point decide where it
  // goes (console.log, or a WebSocket broadcast).
  log: (text: string) => void;
  // Called by commands that mutate agent.getMessages() (/clear,
  // /compact), *before* they log their confirmation. index.ts/tui.tsx
  // don't need it (the terminal has nothing cached to refresh), but
  // server.ts only ever pushes a "history" snapshot once, on connect - an
  // already-open tab would otherwise keep showing stale messages after a
  // command that changed them.
  refreshHistory?: () => void;
}

type CommandHandler = (args: string, ctx: CommandContext) => void | Promise<void>;

interface Command {
  description: string;
  usage?: string;
  run: CommandHandler;
}

const commands: Record<string, Command> = {
  help: { description: "show available commands", run: cmdHelp },
  clear: { description: "clear the conversation history", run: cmdClear },
  history: { description: "show the message history", run: cmdHistory },
  compact: {
    description: "run compaction now (optionally with a strategy)",
    usage: "/compact [sliding|none|summarize]",
    run: cmdCompact,
  },
  debug: {
    description: "control the debug event log (toggle / inspect entries)",
    usage: "/debug [on|off|clear|ls|show [id]]",
    run: cmdDebug,
  },
  exit: { description: "exit the harness", run: cmdExit },
};

export async function runCommand(line: string, ctx: CommandContext): Promise<boolean> {
  if (!line.startsWith("/")) return false;

  const [name, ...rest] = line.slice(1).trim().split(/\s+/);
  const args = rest.join(" ");

  const cmd = commands[name];
  if (!cmd) {
    ctx.log(`unknown command: /${name} (try /help)`);
    return true;
  }
  await cmd.run(args, ctx);
  return true;
}

function cmdHelp(_args: string, ctx: CommandContext): void {
  const lines = ["available commands:"];
  for (const [name, cmd] of Object.entries(commands)) {
    const display = (cmd.usage ?? `/${name}`).padEnd(22);
    lines.push(`  ${display} ${cmd.description}`);
  }
  ctx.log(lines.join("\n"));
}

function cmdClear(_args: string, ctx: CommandContext): void {
  ctx.agent.clearMessages();
  ctx.refreshHistory?.();
  ctx.log("conversation reset");
}

function cmdHistory(_args: string, ctx: CommandContext): void {
  const messages = ctx.agent.getMessages();
  const lines = [`${messages.length} messages in history:`];
  for (const m of messages) {
    const summary = m.content.map(summarizeBlock).join(" ");
    lines.push(`  [${m.role}] ${summary}`);
  }
  ctx.log(lines.join("\n"));
}

function summarizeBlock(b: Block): string {
  switch (b.type) {
    case "text":
      return truncate(b.text.replace(/\s+/g, " "), 60);
    case "tool_use":
      return `[tool_use ${b.toolName}]`;
    case "tool_result":
      return `[tool_result ${b.isError ? "error" : "ok"}]`;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

async function cmdCompact(args: string, ctx: CommandContext): Promise<void> {
  let strategy = ctx.agent.compactor;
  switch (args.toLowerCase()) {
    case "":
      break; // use the strategy already configured on the agent
    case "sliding":
      strategy = new SlidingWindow(6);
      break;
    case "none":
      strategy = new NoCompaction();
      break;
    case "summarize":
      // threshold=1, keepRecent=0: an explicit "/compact summarize" means
      // do it now, on the whole conversation - unlike the config-driven
      // strategy (Phase 8's buildCompactor), which only fires once
      // summarizeThreshold is reached and always leaves keepLast intact.
      strategy = new Summarize(ctx.agent.provider, 1, 0);
      break;
    default:
      ctx.log(`unknown strategy: ${args} (try sliding, none, or summarize)`);
      return;
  }

  const before = ctx.agent.getMessages();
  const compacted = await strategy.compact(before);
  ctx.agent.setMessages(compacted);
  ctx.refreshHistory?.();
  ctx.log(`compacted: ${before.length} → ${compacted.length} messages`);
}

function cmdDebug(args: string, ctx: CommandContext): void {
  const trimmed = args.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const verb = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  switch (verb) {
    case "":
      setEnabled(!isEnabled());
      break;
    case "on":
    case "true":
    case "yes":
      setEnabled(true);
      break;
    case "off":
    case "false":
    case "no":
      setEnabled(false);
      break;
    case "clear":
      clearDebugLog();
      ctx.log("debug log cleared");
      return;
    case "ls":
    case "list":
      cmdDebugList(ctx);
      return;
    case "show":
    case "dump":
      cmdDebugShow(rest, ctx);
      return;
    default:
      ctx.log(`unknown value: ${verb} (try on/off/clear/ls/show)`);
      return;
  }
  ctx.log(`debug: ${isEnabled() ? "on" : "off"}`);
}

function cmdDebugList(ctx: CommandContext): void {
  const events = snapshot();
  if (events.length === 0) {
    ctx.log("debug log is empty");
    return;
  }
  const lines = events.map((e) => {
    const marker = e.payload ? "•" : " ";
    return `  ${marker} #${e.id} ${formatEventTime(e.time)} ${e.source.padEnd(10)} ${e.message}`;
  });
  lines.push(`${events.length} events (• = has payload). use /debug show <id> for full content.`);
  ctx.log(lines.join("\n"));
}

function cmdDebugShow(idStr: string, ctx: CommandContext): void {
  let event: DebugEvent | undefined;
  if (!idStr) {
    event = latest();
    if (!event) {
      ctx.log("debug log is empty");
      return;
    }
  } else {
    const id = Number(idStr);
    if (!Number.isInteger(id)) {
      ctx.log(`not a valid id: ${idStr}`);
      return;
    }
    event = findById(id);
    if (!event) {
      ctx.log(`no event with id #${id} (it may have aged out of the ring)`);
      return;
    }
  }
  const header = `#${event.id}  ${formatEventTime(event.time)}  ${event.source}  ${event.message}`;
  ctx.log(`${header}\n${event.payload || "(no payload)"}`);
}

function formatEventTime(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// Same as cmdExit in Go (direct os.Exit(0), without propagating the signal
// upward): simpler than threading an "exit" through the REPL or the Ink UI,
// at the cost of skipping any pending cleanup (e.g. closing MCP processes)
// — the same limitation the original Go project has, since os.Exit doesn't
// run deferred functions either.
function cmdExit(): void {
  process.exit(0);
}

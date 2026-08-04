// Reduced equivalent of commands.go: a name → handler registry for lines
// starting with "/". runCommand() returns true if the line was a command
// (handled or unrecognized) and false if it should pass through to the
// model as a normal message — same contract as Go's runCommand().

import { NoCompaction, SlidingWindow } from "./context/compactor.js";
import type { Agent } from "./agent.js";
import type { Block } from "./provider/types.js";

export interface CommandContext {
  agent: Agent;
}

type CommandHandler = (args: string, ctx: CommandContext) => void;

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
    usage: "/compact [sliding|none]",
    run: cmdCompact,
  },
  exit: { description: "exit the harness", run: cmdExit },
};

export function runCommand(line: string, ctx: CommandContext): boolean {
  if (!line.startsWith("/")) return false;

  const [name, ...rest] = line.slice(1).trim().split(/\s+/);
  const args = rest.join(" ");

  const cmd = commands[name];
  if (!cmd) {
    console.log(`unknown command: /${name} (try /help)`);
    return true;
  }
  cmd.run(args, ctx);
  return true;
}

function cmdHelp(): void {
  console.log("available commands:");
  for (const [name, cmd] of Object.entries(commands)) {
    const display = (cmd.usage ?? `/${name}`).padEnd(22);
    console.log(`  ${display} ${cmd.description}`);
  }
}

function cmdClear(_args: string, ctx: CommandContext): void {
  ctx.agent.clearMessages();
  console.log("conversation reset");
}

function cmdHistory(_args: string, ctx: CommandContext): void {
  const messages = ctx.agent.getMessages();
  console.log(`${messages.length} messages in history:`);
  for (const m of messages) {
    const summary = m.content.map(summarizeBlock).join(" ");
    console.log(`  [${m.role}] ${summary}`);
  }
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

function cmdCompact(args: string, ctx: CommandContext): void {
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
    default:
      console.log(`unknown strategy: ${args} (try sliding or none)`);
      return;
  }

  const before = ctx.agent.getMessages();
  const compacted = strategy.compact(before);
  ctx.agent.setMessages(compacted);
  console.log(`compacted: ${before.length} → ${compacted.length} messages`);
}

// Same as cmdExit in Go (direct os.Exit(0), without propagating the signal
// upward): simpler than threading an "exit" through the REPL or the Ink UI,
// at the cost of skipping any pending cleanup (e.g. closing MCP processes)
// — the same limitation the original Go project has, since os.Exit doesn't
// run deferred functions either.
function cmdExit(): void {
  process.exit(0);
}

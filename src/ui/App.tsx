// Root TUI component. Equivalent (heavily reduced) to the Bubble Tea
// program in internal/ui/program.go: owns the session state — the input
// line, a spinner while the model is thinking, and a [y/N] prompt when a
// tool requests approval.
//
// We deliberately do NOT keep our own message log in React state. Ink
// patches console.log/error by default (see render() in tui.tsx) so its
// output lands in the scrollback above the "live" region we do re-render —
// so Agent and commands.ts, which already call console.log for
// everything, work with zero changes.
//
// A single useInput, always mounted. The first version had a separate
// useInput inside each InputLine, active only in "input" mode — but
// useInput disables the terminal's raw mode (stdin.setRawMode(false)) on
// unmount, and re-enables it on remount. That toggling between turns
// (every time the spinner appeared) left a window where the terminal went
// back to normal echo and could drop or desync keystrokes typed right at
// the transition. With a single App-level useInput that never unmounts,
// raw mode stays stable for the whole session; the current `mode` only
// decides which branch of logic runs inside the same handler.

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { Agent } from "../agent.js";
import { runCommand } from "../commands.js";
import { InputLine } from "./InputLine.js";
import { Spinner } from "./Spinner.js";

type Mode = "input" | "thinking" | "approval";

export interface AppProps {
  agent: Agent;
  registerConfirm: (fn: (name: string, rawInput: string) => Promise<boolean>) => void;
}

export function App({ agent, registerConfirm }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<Mode>("input");
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const pendingApproval = useRef<{ resolve: (approved: boolean) => void } | null>(null);

  // Wires up the agent's real confirm exactly once on mount — the same
  // moment Go assigns rootAgent.Confirm after building the Bubble Tea
  // program in main.go.
  useEffect(() => {
    registerConfirm(
      (name, rawInput) =>
        new Promise<boolean>((resolve) => {
          console.log(`  approve "${name}" ${rawInput}? [y/N]`);
          pendingApproval.current = { resolve };
          setMode("approval");
        }),
    );
  }, [registerConfirm]);

  const handleSubmit = useCallback(
    async (line: string) => {
      setHistory((h) => [...h, line]);
      console.log(`> ${line}`);

      if (runCommand(line, { agent })) {
        console.log();
        return;
      }

      setMode("thinking");
      try {
        await agent.send(line);
      } catch (err) {
        console.error("error:", (err as Error).message);
      } finally {
        console.log();
        setMode("input");
      }
    },
    [agent],
  );

  useInput((input, key) => {
    if (mode === "approval") {
      const approved = input.toLowerCase() === "y";
      console.log(approved ? "  → yes\n" : "  → no\n");
      pendingApproval.current?.resolve(approved);
      pendingApproval.current = null;
      setMode("input");
      return;
    }

    if (mode === "thinking") return; // ignore keystrokes while the model is responding

    if (key.ctrl && input === "d") {
      exit();
      return;
    }

    if (key.return) {
      const line = value.trim();
      setValue("");
      setHistoryIndex(null);
      if (line) void handleSubmit(line);
      return;
    }

    if (key.upArrow) {
      if (history.length === 0) return;
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setValue(history[next]);
      return;
    }

    if (key.downArrow) {
      if (historyIndex === null) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setValue("");
      } else {
        setHistoryIndex(next);
        setValue(history[next]);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    if (key.ctrl || key.meta || key.tab || key.escape) return;

    setValue((v) => v + input);
  });

  return (
    <Box>
      {mode === "approval" ? (
        <Text dimColor>y/N </Text>
      ) : mode === "thinking" ? (
        <Spinner label="thinking…" />
      ) : (
        <InputLine prompt="> " value={value} active />
      )}
    </Box>
  );
}

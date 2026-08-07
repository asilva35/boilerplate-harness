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
import type { Provider } from "../provider/types.js";
import { buildWriteDiff } from "../tools/diff.js";
import { InputLine } from "./InputLine.js";
import { Spinner } from "./Spinner.js";

type Mode = "input" | "thinking" | "approval";

export interface AppProps {
  agent: Agent;
  registerConfirm: (fn: (name: string, rawInput: string) => Promise<boolean>) => void;
  registerTextDelta: (fn: (chunk: string) => void) => void;
  registerStreamReset: (fn: () => void) => void;
  // Phase 25: backs "/provider" - see tui.tsx's own switchProvider.
  switchProvider: (name: string, model?: string) => Provider;
}

// How often accumulated text-delta chunks get flushed into React state
// while streaming - re-rendering on every single token would flicker the
// terminal and add pointless work for a text delta the eye can't tell
// apart from an occasional 60ms-batched update anyway.
const STREAM_FLUSH_MS = 60;

export function App({ agent, registerConfirm, registerTextDelta, registerStreamReset, switchProvider }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<Mode>("input");
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const pendingApproval = useRef<{ resolve: (approved: boolean) => void } | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const streamBufferRef = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetStream = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    streamBufferRef.current = "";
    setStreamingText("");
  }, []);

  // Wires up the live streaming preview exactly once on mount, same
  // pattern as registerConfirm below: onTextDelta appends into a ref
  // (avoiding a re-render per token) and a trailing timer flushes it into
  // state at most every STREAM_FLUSH_MS. registerStreamReset fires right
  // when a text block finalizes (see onAssistantText in tui.tsx), so the
  // preview clears instead of showing stale text once it's already been
  // pushed to the real scrollback via console.log.
  useEffect(() => {
    registerTextDelta((chunk) => {
      streamBufferRef.current += chunk;
      if (flushTimer.current) return;
      flushTimer.current = setTimeout(() => {
        flushTimer.current = null;
        setStreamingText(streamBufferRef.current);
      }, STREAM_FLUSH_MS);
    });
  }, [registerTextDelta]);

  useEffect(() => {
    registerStreamReset(resetStream);
  }, [registerStreamReset, resetStream]);

  // Wires up the agent's real confirm exactly once on mount — the same
  // moment Go assigns rootAgent.Confirm after building the Bubble Tea
  // program in main.go.
  useEffect(() => {
    registerConfirm(
      (name, rawInput) =>
        new Promise<boolean>((resolve) => {
          const diff = name === "write_file" ? buildWriteDiff(rawInput) : "";
          if (diff) {
            console.log(diff);
            console.log("  approve this write? [y/N]");
          } else {
            console.log(`  approve "${name}" ${rawInput}? [y/N]`);
          }
          pendingApproval.current = { resolve };
          setMode("approval");
        }),
    );
  }, [registerConfirm]);

  const handleSubmit = useCallback(
    async (line: string) => {
      setHistory((h) => [...h, line]);
      console.log(`> ${line}`);

      if (await runCommand(line, { agent, log: console.log, switchProvider })) {
        console.log();
        return;
      }

      setMode("thinking");
      resetStream();
      try {
        await agent.send(line);
      } catch (err) {
        console.error("error:", (err as Error).message);
      } finally {
        console.log();
        resetStream();
        setMode("input");
      }
    },
    [agent, resetStream, switchProvider],
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

    if (key.ctrl && (input === "d" || input === "c")) {
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
        streamingText ? <Text>{streamingText}</Text> : <Spinner label="thinking…" />
      ) : (
        <InputLine prompt="> " value={value} active />
      )}
    </Box>
  );
}

// Same protocol and reconnect behavior as src/web/index.html (Phase 6),
// ported to a React hook: connect, rebuild the feed from `history` on
// (re)connect, append one feed item per live event, and reconnect with the
// same doubling backoff (capped at 10s) on close.

import { useCallback, useEffect, useRef, useState } from "react";
import { truncate, type ClientMessage, type Message, type ServerMessage } from "@/lib/protocol";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type Mode = "idle" | "thinking" | "approval";

export interface FeedItem {
  id: number;
  kind: "bubble" | "chip" | "error";
  role?: "user" | "assistant";
  text: string;
}

export interface PendingApproval {
  name: string;
  input: string;
}

const MAX_RECONNECT_DELAY_MS = 10_000;

export function useHarnessSocket() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [mode, setMode] = useState<Mode>("idle");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const nextIdRef = useRef(0);

  const nextId = useCallback(() => nextIdRef.current++, []);

  const renderHistory = useCallback(
    (messages: Message[]) => {
      const items: FeedItem[] = [];
      for (const m of messages) {
        for (const block of m.content) {
          if (block.type === "text") {
            if (block.text.trim()) items.push({ id: nextId(), kind: "bubble", role: m.role, text: block.text });
          } else if (block.type === "tool_use") {
            items.push({
              id: nextId(),
              kind: "chip",
              text: `🔧 ${block.toolName} ${truncate(block.toolInput, 200)}`,
            });
          } else if (block.type === "tool_result") {
            items.push({
              id: nextId(),
              kind: "chip",
              text: `${block.isError ? "✗" : "✓"} ${truncate(block.toolResult, 200)}`,
            });
          }
        }
      }
      setFeed(items);
    },
    [nextId],
  );

  useEffect(() => {
    let cancelled = false;

    function connect() {
      const proto = location.protocol === "https:" ? "wss://" : "ws://";
      const socket = new WebSocket(proto + location.host);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (cancelled) return;
        setStatus("connected");
        reconnectDelayRef.current = 1000;
      });

      socket.addEventListener("close", () => {
        if (cancelled) return;
        setStatus("disconnected");
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
        setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => socket.close());

      socket.addEventListener("message", (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "history":
            renderHistory(msg.messages);
            setMode("idle");
            break;
          case "user_text":
            setFeed((prev) => [...prev, { id: nextId(), kind: "bubble", role: "user", text: msg.text }]);
            break;
          case "assistant_text":
            setFeed((prev) => [...prev, { id: nextId(), kind: "bubble", role: "assistant", text: msg.text }]);
            break;
          case "tool_call":
            setFeed((prev) => [
              ...prev,
              { id: nextId(), kind: "chip", text: `🔧 ${msg.name} ${truncate(msg.input, 200)}` },
            ]);
            break;
          case "confirm_request":
            setPendingApproval({ name: msg.name, input: msg.input });
            setMode("approval");
            break;
          case "mode":
            // A late "idle" broadcast should never dismiss a pending
            // approval dialog - mirrors the `!pendingApproval` guard in
            // the Phase 6 vanilla client.
            setMode((current) => (msg.mode === "thinking" ? "thinking" : current === "approval" ? current : "idle"));
            break;
          case "error":
            setFeed((prev) => [...prev, { id: nextId(), kind: "error", text: msg.message }]);
            break;
        }
      });
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [nextId, renderHistory]);

  const send = useCallback((line: string) => {
    const trimmed = line.trim();
    const socket = socketRef.current;
    if (!trimmed || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "input", line: trimmed } satisfies ClientMessage));
  }, []);

  const respondApproval = useCallback((approved: boolean) => {
    setPendingApproval(null);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "confirm_response", approved } satisfies ClientMessage));
    }
    setMode("idle");
  }, []);

  return { status, mode, feed, pendingApproval, send, respondApproval };
}

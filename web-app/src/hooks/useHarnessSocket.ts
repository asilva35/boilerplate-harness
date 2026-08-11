// Same protocol and reconnect behavior as src/web/index.html (Phase 6),
// ported to a React hook: connect, rebuild the feed from `history` on
// (re)connect, append one feed item per live event, and reconnect with the
// same doubling backoff (capped at 10s) on close.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  truncate,
  type ClientMessage,
  type DebugEvent,
  type ImageAttachment,
  type Message,
  type ServerMessage,
} from "@/lib/protocol";

// Mirrors src/debug.ts's own RING_CAPACITY - no point keeping more client-
// side than the server itself would ever have live at once.
const MAX_DEBUG_EVENTS = 500;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type Mode = "idle" | "thinking" | "approval";

export interface FeedItem {
  id: number;
  kind: "bubble" | "chip" | "error" | "command" | "risk" | "image";
  role?: "user" | "assistant";
  text: string;
  // Only set for kind "risk" - styling varies by severity ("high" reads
  // more urgent than "low"), unlike every other kind which has one look.
  level?: "low" | "high";
  // Only set for kind "image" - a ready-to-render data: URI (mediaType +
  // base64 data joined together), built once here rather than in every
  // renderer that needs one.
  imageUrl?: string;
}

function toDataUrl(img: ImageAttachment): string {
  return `data:${img.mediaType};base64,${img.data}`;
}

export interface PendingApproval {
  name: string;
  input: string;
  diff?: string;
}

const MAX_RECONNECT_DELAY_MS = 10_000;

export function useHarnessSocket() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [mode, setMode] = useState<Mode>("idle");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const nextIdRef = useRef(0);
  // Tracks the feed item currently being filled in by text_delta chunks,
  // so each chunk appends to it instead of creating a new bubble per
  // token; assistant_text clears it once the block is done and replaces
  // the accumulated text with the authoritative final version.
  const streamingIdRef = useRef<number | null>(null);

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
          } else if (block.type === "image") {
            items.push({ id: nextId(), kind: "image", role: m.role, text: "", imageUrl: toDataUrl(block) });
          }
        }
      }
      setFeed(items);
    },
    [nextId],
  );

  useEffect(() => {
    let cancelled = false;

    // Phase 20: identifies this tab's conversation to the server. Read
    // from the URL if a link already carried one (e.g. shared/bookmarked);
    // otherwise mint one and write it back via replaceState so a
    // reconnect (the backoff loop below) or a plain page refresh lands on
    // the same session instead of silently starting a new one each time.
    const params = new URLSearchParams(location.search);
    let sessionId = params.get("session");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      params.set("session", sessionId);
      history.replaceState(null, "", `${location.pathname}?${params}`);
    }

    function connect() {
      const proto = location.protocol === "https:" ? "wss://" : "ws://";
      const socket = new WebSocket(`${proto}${location.host}/?session=${encodeURIComponent(sessionId!)}`);
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
            streamingIdRef.current = null;
            renderHistory(msg.messages);
            setMode("idle");
            break;
          case "user_text": {
            const items: FeedItem[] = [];
            if (msg.text) items.push({ id: nextId(), kind: "bubble", role: "user", text: msg.text });
            for (const img of msg.images ?? []) {
              items.push({ id: nextId(), kind: "image", role: "user", text: "", imageUrl: toDataUrl(img) });
            }
            setFeed((prev) => [...prev, ...items]);
            break;
          }
          case "text_delta":
            setFeed((prev) => {
              if (streamingIdRef.current === null) {
                const id = nextId();
                streamingIdRef.current = id;
                return [...prev, { id, kind: "bubble", role: "assistant", text: msg.text }];
              }
              return prev.map((item) =>
                item.id === streamingIdRef.current ? { ...item, text: item.text + msg.text } : item,
              );
            });
            break;
          case "assistant_text":
            setFeed((prev) => {
              const id = streamingIdRef.current;
              if (id !== null) {
                streamingIdRef.current = null;
                return prev.map((item) => (item.id === id ? { ...item, text: msg.text } : item));
              }
              return [...prev, { id: nextId(), kind: "bubble", role: "assistant", text: msg.text }];
            });
            break;
          case "tool_call":
            setFeed((prev) => [
              ...prev,
              { id: nextId(), kind: "chip", text: `🔧 ${msg.name} ${truncate(msg.input, 200)}` },
            ]);
            break;
          case "risk_flag": {
            if (msg.risk === "none") break; // server never actually sends this, but stay defensive
            const level = msg.risk; // narrow once, outside the closure below
            setFeed((prev) => [
              ...prev,
              {
                id: nextId(),
                kind: "risk",
                level,
                text: `[${msg.name}] risk: ${level}${msg.nextRecommended ? ` — next: ${msg.nextRecommended}` : ""}`,
              },
            ]);
            break;
          }
          case "debug_event":
            setDebugEvents((prev) => {
              const next = [...prev, msg.event];
              return next.length > MAX_DEBUG_EVENTS ? next.slice(next.length - MAX_DEBUG_EVENTS) : next;
            });
            break;
          case "confirm_request":
            setPendingApproval({ name: msg.name, input: msg.input, diff: msg.diff });
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
          case "command_output":
            setFeed((prev) => [...prev, { id: nextId(), kind: "command", text: msg.text }]);
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

  const send = useCallback((line: string, images?: ImageAttachment[]) => {
    const trimmed = line.trim();
    const socket = socketRef.current;
    if ((!trimmed && !images?.length) || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "input", line: trimmed, images } satisfies ClientMessage));
  }, []);

  const respondApproval = useCallback((approved: boolean) => {
    setPendingApproval(null);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "confirm_response", approved } satisfies ClientMessage));
    }
    setMode("idle");
  }, []);

  return { status, mode, feed, pendingApproval, debugEvents, send, respondApproval };
}

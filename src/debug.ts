// Equivalent to internal/debug/debug.go: a lightweight in-memory ring
// buffer of events, surfaced via the /debug command (commands.ts). Call
// sites emit events with record()/recordCorrelated(); when disabled,
// recording short-circuits to roughly one boolean check - no allocation,
// no cost.
//
// A module-level singleton, deliberately - same call Go makes and for the
// same reason: this is a cross-cutting concern read from deep inside
// agent.ts and both providers, several layers away from where entry
// points wire up explicit dependencies like Provider/MemoryStore/
// SkillRegistry. Threading a DebugLog instance through every intermediate
// signature would be a much bigger blast radius than a diagnostic
// facility like this earns.
//
// Simplification vs Go: no Recordf/Recordfc printf variants - JS already
// has template literals, so record()/recordCorrelated() take a plain
// message string and callers interpolate inline instead of a separate
// printf-style helper.

export type Level = "info" | "warn" | "error";

export interface DebugEvent {
  id: number;
  correlatedId: number; // 0 when this event has no pair
  time: Date;
  source: string; // "provider", "tool", "compact", ...
  level: Level;
  message: string;
  payload: string; // "" when there's nothing extra to inspect
}

const RING_CAPACITY = 500;
const MAX_PAYLOAD_CHARS = 100 * 1024; // per-event cap to keep memory bounded
const TRUNCATION_MARKER = "\n…[truncated]";

let events: DebugEvent[] = [];
let enabled = false;
let nextId = 0;
let sink: ((event: DebugEvent) => void) | undefined;

export function isEnabled(): boolean {
  return enabled;
}

// Disabling does not clear the ring - old events stick around until
// clear() or the process exits.
export function setEnabled(value: boolean): void {
  enabled = value;
}

// Registers a callback fired on every recorded event (e.g. server.ts
// broadcasting it to the browser). Pass undefined to unregister.
export function setSink(fn: ((event: DebugEvent) => void) | undefined): void {
  sink = fn;
}

// Appends a payload-less event and returns its id (0 if disabled).
export function record(source: string, level: Level, message: string, payload = ""): number {
  return recordCorrelated(0, source, level, message, payload);
}

// record(), but linked back to a previously-recorded event (typically the
// request a response belongs to). pair() can then walk the link in
// either direction.
export function recordCorrelated(
  correlatedId: number,
  source: string,
  level: Level,
  message: string,
  payload = "",
): number {
  if (!enabled) return 0;

  if (events.length >= RING_CAPACITY) events.shift();

  const event: DebugEvent = {
    id: ++nextId,
    correlatedId,
    time: new Date(),
    source,
    level,
    message,
    payload: truncatePayload(payload),
  };
  events.push(event);
  sink?.(event);
  return event.id;
}

function truncatePayload(payload: string): string {
  if (payload.length <= MAX_PAYLOAD_CHARS) return payload;
  return payload.slice(0, MAX_PAYLOAD_CHARS) + TRUNCATION_MARKER;
}

// Returns the event linked to id, in either direction: if the given event
// has a correlatedId, that's the request it's paired with; otherwise
// looks for an event whose correlatedId equals id (its response).
// Undefined when no link exists or the paired event has aged out of the
// ring.
export function pair(id: number): DebugEvent | undefined {
  const target = events.find((e) => e.id === id);
  if (!target) return undefined;

  if (target.correlatedId !== 0) {
    return events.find((e) => e.id === target.correlatedId);
  }
  return events.find((e) => e.correlatedId === target.id);
}

export function findById(id: number): DebugEvent | undefined {
  return events.find((e) => e.id === id);
}

// The most recent event that has a payload, or just the most recent event
// if none do. Undefined when the ring is empty. Used by "/debug show"
// with no argument.
export function latest(): DebugEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].payload) return events[i];
  }
  return events[events.length - 1];
}

// A copy of the current ring, oldest first.
export function snapshot(): DebugEvent[] {
  return [...events];
}

export function clear(): void {
  events = [];
}

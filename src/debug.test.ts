import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clear,
  findById,
  isEnabled,
  latest,
  pair,
  record,
  recordCorrelated,
  setEnabled,
  setSink,
  snapshot,
} from "./debug.js";

// Each test starts from a clean, disabled ring - the module is a
// singleton, so state would otherwise leak between tests.
beforeEach(() => {
  setEnabled(false);
  clear();
  setSink(undefined);
});

test("record() is a no-op returning 0 while disabled", () => {
  const id = record("tool", "info", "should not be recorded");

  assert.equal(id, 0);
  assert.deepEqual(snapshot(), []);
});

test("record() appends an event and returns a non-zero id once enabled", () => {
  setEnabled(true);

  const id = record("tool", "info", "hello");

  assert.notEqual(id, 0);
  const events = snapshot();
  assert.equal(events.length, 1);
  assert.equal(events[0].id, id);
  assert.equal(events[0].source, "tool");
  assert.equal(events[0].level, "info");
  assert.equal(events[0].message, "hello");
  assert.equal(events[0].payload, "");
  assert.equal(events[0].correlatedId, 0);
});

test("ids increase monotonically across calls, even across enable/disable cycles", () => {
  setEnabled(true);
  const first = record("a", "info", "1");
  setEnabled(false);
  record("a", "info", "dropped, should not consume an id"); // returns 0, doesn't touch nextId
  setEnabled(true);
  const second = record("a", "info", "2");

  assert.equal(second, first + 1);
});

test("recordCorrelated() links two events, and pair() walks either direction", () => {
  setEnabled(true);
  const reqId = recordCorrelated(0, "provider", "info", "request");
  const respId = recordCorrelated(reqId, "provider", "info", "response");

  assert.deepEqual(pair(reqId)?.id, respId);
  assert.deepEqual(pair(respId)?.id, reqId);
});

test("pair() returns undefined for an event with no link", () => {
  setEnabled(true);
  const id = record("tool", "info", "solo");

  assert.equal(pair(id), undefined);
});

test("pair() returns undefined for an unknown id", () => {
  assert.equal(pair(999), undefined);
});

test("the ring drops the oldest event once it exceeds capacity (500)", () => {
  setEnabled(true);
  for (let i = 0; i < 501; i++) record("tool", "info", `event ${i}`);

  const events = snapshot();
  assert.equal(events.length, 500);
  assert.equal(events[0].message, "event 1"); // "event 0" was dropped
  assert.equal(events[499].message, "event 500");
});

test("a payload over the per-event cap gets truncated with a marker", () => {
  setEnabled(true);
  const CAP = 100 * 1024;
  const huge = "x".repeat(CAP * 2); // comfortably over the cap, not just barely

  record("tool", "info", "big payload", huge);

  const [event] = snapshot();
  assert.ok(event.payload.length < huge.length);
  assert.match(event.payload, /…\[truncated\]$/);
  assert.equal(event.payload.slice(0, CAP), huge.slice(0, CAP)); // real content is a clean prefix
});

test("a payload right at the cap is kept as-is, no marker", () => {
  setEnabled(true);
  const exact = "x".repeat(100 * 1024);

  record("tool", "info", "exactly at cap", exact);

  const [event] = snapshot();
  assert.equal(event.payload, exact);
});

test("latest() prefers the most recent event that has a payload", () => {
  setEnabled(true);
  record("tool", "info", "no payload here");
  const withPayloadId = record("tool", "info", "has one", "some payload");
  record("tool", "info", "no payload either");

  assert.equal(latest()?.id, withPayloadId);
});

test("latest() falls back to the most recent event when none have a payload", () => {
  setEnabled(true);
  record("tool", "info", "first");
  const lastId = record("tool", "info", "second");

  assert.equal(latest()?.id, lastId);
});

test("latest() is undefined when the ring is empty", () => {
  assert.equal(latest(), undefined);
});

test("findById() looks up a specific event, undefined when not present", () => {
  setEnabled(true);
  const id = record("tool", "info", "findable");

  assert.equal(findById(id)?.message, "findable");
  assert.equal(findById(id + 999), undefined);
});

test("clear() empties the ring", () => {
  setEnabled(true);
  record("tool", "info", "will be cleared");

  clear();

  assert.deepEqual(snapshot(), []);
});

test("setSink() fires on every recorded event, not at all when disabled", () => {
  const seen: string[] = [];
  setSink((e) => seen.push(e.message));

  record("tool", "info", "while disabled");
  assert.deepEqual(seen, []);

  setEnabled(true);
  record("tool", "info", "while enabled");
  assert.deepEqual(seen, ["while enabled"]);
});

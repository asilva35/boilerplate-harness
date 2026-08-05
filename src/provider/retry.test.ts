import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "./retry.js";

// Stands in for Anthropic.APIError / OpenAI.APIError without depending on
// either SDK — both throw objects shaped exactly like this.
class FakeApiError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly headers: Record<string, string> = {},
  ) {
    super(`fake api error ${status}`);
  }
}

function recordingSleep(delays: number[]) {
  return async (ms: number) => {
    delays.push(ms);
  };
}

test("retries a 429 and eventually resolves", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new FakeApiError(429);
      return "ok";
    },
    { retries: 3, baseDelayMs: 10, sleep: recordingSleep([]) },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("respects the retry-after header instead of the blind exponential backoff", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw new FakeApiError(429, { "retry-after": "2" });
      return "ok";
    },
    { retries: 3, baseDelayMs: 999, sleep: recordingSleep(delays) },
  );

  assert.deepEqual(delays, [2000]);
});

test("retries a 5xx and a connection error (status undefined) with exponential backoff", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw new FakeApiError(503);
      if (calls === 2) throw new FakeApiError(undefined);
      return "ok";
    },
    { retries: 3, baseDelayMs: 10, sleep: recordingSleep(delays) },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("never retries a validation error (4xx that isn't a rate limit)", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new FakeApiError(400);
        },
        { retries: 3, baseDelayMs: 5, sleep: recordingSleep([]) },
      ),
    /fake api error 400/,
  );
  assert.equal(calls, 1);
});

test("gives up after exhausting retries and propagates the last error", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new FakeApiError(500);
        },
        { retries: 2, baseDelayMs: 5, sleep: recordingSleep([]) },
      ),
    /fake api error 500/,
  );
  assert.equal(calls, 3); // initial attempt + 2 retries
});

test("never retries an unrelated error that isn't shaped like an APIError", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new TypeError("boom");
        },
        { retries: 3, baseDelayMs: 5, sleep: recordingSleep([]) },
      ),
    /boom/,
  );
  assert.equal(calls, 1);
});

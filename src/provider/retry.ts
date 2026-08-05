// Neither original Go provider retries anything — a 429, a 5xx, or a
// dropped connection just aborted the whole turn. This wraps a provider
// SDK call with exponential backoff, retrying only transient errors (429,
// 5xx, connection failures) and respecting the SDK's `Retry-After` header
// when the provider sends one, instead of guessing a blind delay.

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  // Injected in tests so they don't have to wait on real timers.
  sleep?: (ms: number) => Promise<void>;
}

// Both the Anthropic and OpenAI SDKs throw an APIError shaped like this on
// every non-2xx response, and use the same shape (status: undefined) for
// connection failures/timeouts, where no HTTP response was ever received.
interface ApiErrorLike {
  status?: number;
  headers?: Record<string, string | null | undefined>;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 500, sleep = defaultSleep } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      await sleep(retryAfterMs(err) ?? baseDelayMs * 2 ** attempt);
    }
  }
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as ApiErrorLike).status;
  return status === undefined || status === 429 || status >= 500;
}

function retryAfterMs(err: unknown): number | undefined {
  const value = (err as ApiErrorLike)?.headers?.["retry-after"];
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

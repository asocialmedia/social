import { describe, expect, test } from "bun:test";

import {
  AbortError,
  backoffDelay,
  HttpError,
  isRetryable,
  parseRetryAfter,
  withRetry,
} from "./retry";

describe("isRetryable", () => {
  test("retries network errors, timeouts, rate limits and 5xx", () => {
    expect(isRetryable(new TypeError("Network request failed"))).toBe(true);
    expect(isRetryable(new HttpError("x", 408))).toBe(true);
    expect(isRetryable(new HttpError("x", 429))).toBe(true);
    expect(isRetryable(new HttpError("x", 503))).toBe(true);
  });

  test("never retries client errors or cancellation", () => {
    expect(isRetryable(new HttpError("x", 400))).toBe(false);
    expect(isRetryable(new HttpError("x", 413))).toBe(false);
    expect(isRetryable(new AbortError())).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  test("reads seconds and caps them", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter("9999")).toBe(60_000);
  });

  test("reads http dates relative to now", () => {
    const now = Date.parse("2026-09-23T00:00:00Z");
    expect(parseRetryAfter("Wed, 23 Sep 2026 00:00:05 GMT", now)).toBe(5000);
  });

  test("ignores missing or junk headers", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("backoffDelay", () => {
  test("grows exponentially with jitter inside [ceiling/2, ceiling]", () => {
    expect(backoffDelay(1, { random: () => 0 })).toBe(500);
    expect(backoffDelay(1, { random: () => 1 })).toBe(1000);
    expect(backoffDelay(3, { random: () => 1 })).toBe(4000);
    expect(backoffDelay(20, { random: () => 1 })).toBe(30_000);
  });

  test("honors a server retry-after hint", () => {
    expect(backoffDelay(1, { retryAfterMs: 7000 })).toBe(7000);
  });
});

describe("withRetry", () => {
  test("retries transient failures until success", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) {
          return Promise.reject(new HttpError("busy", 503, null, 0));
        }
        return Promise.resolve("ok");
      },
      { attempts: 4 }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("surfaces a client error immediately", async () => {
    let calls = 0;
    const failing = withRetry(
      () => {
        calls += 1;
        return Promise.reject(new HttpError("bad", 400));
      },
      { attempts: 4 }
    );
    await expect(failing).rejects.toThrow("bad");
    expect(calls).toBe(1);
  });

  test("gives up after the last attempt", async () => {
    const failing = withRetry(
      () => Promise.reject(new HttpError("down", 500, null, 0)),
      { attempts: 2 }
    );
    await expect(failing).rejects.toThrow("down");
  });
});

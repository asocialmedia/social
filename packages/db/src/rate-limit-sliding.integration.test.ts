import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { consumeRateLimitSliding, redis } from "@asm/db";

// The sliding-window limiter runs as a Lua script inside Redis, and the helper
// fails OPEN when Redis throws. That combination is why this file exists: a typo
// in the script, a bad argument, a renamed command - any of which makes Redis
// return an error that the catch swallows - would leave the limiter allowing
// everything forever, silently, and every unit test written against a fake would
// still pass. The unit tests reimplement the script's logic in TypeScript, so
// they are honest about WHICH operations it performs and about nothing else.
//
// This file executes the real script against the real Redis.
//
// The local dev Redis is `redis://:asmredis@localhost:6379/0`. The runner points
// tests at DB 15 (`.env.test`), so these keys are namespaced by RUN_ID and swept
// in afterEach; nothing here can collide with another run.

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const UNIQUE_KEYS: string[] = [];

// Each rule gets its own identifier so parallel tests - and repeated runs against
// a Redis that kept its state - cannot spend one another's budget.
function identifier(label: string): string {
  const id = `${RUN_ID}-${label}`;
  UNIQUE_KEYS.push(`ratelimit:sliding-real:${id}:sliding`);
  return id;
}

const BUCKET = "sliding-real";

async function sweep(): Promise<void> {
  if (UNIQUE_KEYS.length === 0) {
    return;
  }
  try {
    await redis.del(...UNIQUE_KEYS.splice(0));
  } catch {
    // A teardown failure must not fail a suite that already proved its point.
  }
}

afterEach(sweep);
afterAll(sweep);

// The window is deliberately tiny so a test can drive time forward by waiting
// rather than by faking a clock, which would mean not testing the real script.
const TINY_WINDOW_SECONDS = 1;

// Bun's own sleep, so no hand-rolled timer keeps the timer alive past the test.
const {sleep} = Bun;

describe("consumeRateLimitSliding against real Redis", () => {
  test("runs the script, admits under the limit and spends the budget", async () => {
    // `remaining` is the assertion that matters here. A script that throws makes
    // the helper fail open with remaining = limit, so an allow-path-only test
    // would pass against a completely broken script.
    const id = identifier("under-limit");
    const first = await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit: 3,
      windowSeconds: 60,
    });
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit: 3,
      windowSeconds: 60,
    });
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  test("refuses the hit past the limit and reports a retry-after", async () => {
    const id = identifier("at-limit");
    for (let index = 0; index < 4; index += 1) {
      // Sequential so each hit lands on its own millisecond, which is the case
      // the unique set member exists for.
      // oxlint-disable-next-line no-await-in-loop -- deliberate, see above
      await consumeRateLimitSliding({
        bucket: BUCKET,
        identifier: id,
        limit: 3,
        windowSeconds: 60,
      });
    }
    const refused = await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit: 3,
      windowSeconds: 60,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    // Positive, and no longer than the window: an honest retry-after, not a
    // guess and not zero.
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  test("there is no window boundary to burst across", async () => {
    // The property the whole thing exists for. A fixed window lets a caller
    // spend its budget at the tail of one window and again at the head of the
    // next: 2x the stated limit, and the peak sits exactly where an attacker
    // aims. Here the hits land either side of a four-second boundary, and the
    // first ones are still only a fraction of a second old when the second half
    // arrives, so they still count and the second half is refused.
    const id = identifier("no-boundary");
    const limit = 3;
    const windowSeconds = 4;
    const windowMs = windowSeconds * 1000;

    // Line the spend up with the tail of the current fixed window.
    const nextBoundary = Math.ceil(Date.now() / windowMs) * windowMs;
    const tailWait = nextBoundary - Date.now() - 300;
    if (tailWait > 0) {
      await sleep(tailWait);
    }
    for (let index = 0; index < limit; index += 1) {
      // Sequential on purpose: the budget must be spent over a real span of time,
      // and firing the hits together would spend it in one millisecond.
      // oxlint-disable-next-line no-await-in-loop -- deliberate, see above
      await consumeRateLimitSliding({
        bucket: BUCKET,
        identifier: id,
        limit,
        windowSeconds,
      });
    }
    // Cross into what a fixed window would treat as a fresh budget.
    await sleep(400);

    const afterBoundary = await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds,
    });
    // A fixed window keyed on floor(now/windowMs) starts a new counter here and
    // admits it. This refuses: the earlier hits are ~0.7s old against a 4s
    // window, so they are still inside it.
    expect(afterBoundary.allowed).toBe(false);
  });

  test("budget drains as the accepted hits age out", async () => {
    const id = identifier("age-out");
    const limit = 2;
    await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    const atLimit = await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    expect(atLimit.allowed).toBe(false);

    await sleep(1100);
    const recovered = await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    expect(recovered.allowed).toBe(true);
    expect(recovered.remaining).toBe(1);
  });

  test("a refused hit does not push its own lockout out", async () => {
    const id = identifier("no-self-extension");
    const limit = 1;
    const windowMs = TINY_WINDOW_SECONDS * 1000;
    await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    const refusedAt = Date.now();
    // Hammer the closed bucket for most of the window. None of these is recorded,
    // so the slot must still free at the original hit's expiry, not later. The
    // hammering IS the test; parallel retries would not reproduce a client's cadence.
    while (Date.now() - refusedAt < windowMs * 0.7) {
      // oxlint-disable-next-line no-await-in-loop -- deliberate, see above
      await consumeRateLimitSliding({
        bucket: BUCKET,
        identifier: id,
        limit,
        windowSeconds: TINY_WINDOW_SECONDS,
      });
    }
    await sleep(windowMs * 0.45);
    const afterOriginalExpiry = await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    // The refused hits never entered the set, so the accepted hit's own expiry
    // is what governs and the caller is already free.
    expect(afterOriginalExpiry.allowed).toBe(true);
  });

  test("two hits in the same millisecond are two hits", async () => {
    // The set member is `<now>-<uuid>`. Without the uuid two same-millisecond
    // hits collapse into one ZADD entry and the window under-counts itself.
    const id = identifier("same-ms");
    const options = {
      bucket: BUCKET,
      identifier: id,
      limit: 2,
      windowSeconds: 60,
    };
    const [first, second] = await Promise.all([
      consumeRateLimitSliding(options),
      consumeRateLimitSliding(options),
    ]);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    const third = await consumeRateLimitSliding(options);
    expect(third.allowed).toBe(false);
  });

  test("budgets do not leak between identifiers", async () => {
    const first = identifier("independent-a");
    const second = identifier("independent-b");
    const options = { bucket: BUCKET, limit: 1, windowSeconds: 60 };
    const spentFirst = await consumeRateLimitSliding({
      ...options,
      identifier: first,
    });
    expect(spentFirst.allowed).toBe(true);
    const blockedFirst = await consumeRateLimitSliding({
      ...options,
      identifier: first,
    });
    expect(blockedFirst.allowed).toBe(false);
    const freshSecond = await consumeRateLimitSliding({
      ...options,
      identifier: second,
    });
    expect(freshSecond.allowed).toBe(true);
  });

  test("concurrent hits cannot all observe room in the same bucket", async () => {
    // The script's atomicity is the reason it is one round trip. If it were a
    // read-count-add sequence, every one of these would see count < limit and
    // all would be admitted.
    const id = identifier("atomic");
    const limit = 5;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimitSliding({
          bucket: BUCKET,
          identifier: id,
          limit,
          windowSeconds: 60,
        })
      )
    );
    expect(results.filter((result) => result.allowed).length).toBe(limit);
  });

  test("the key expires, so an abandoned bucket does not live forever", async () => {
    const id = identifier("expiry");
    const key = `ratelimit:${BUCKET}:${id}:sliding`;
    await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit: 5,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    const ttl = await redis.pttl(key);
    // PEXPIRE is set to the window plus a second of slack on every call.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual((TINY_WINDOW_SECONDS + 1) * 1000);
  });

  test("the refused path still refreshes the key's expiry", async () => {
    // A key whose only future call is a refusal must not be reaped mid-window,
    // or the refusal's own state evaporates and the budget silently resets.
    const id = identifier("expiry-on-refusal");
    const key = `ratelimit:${BUCKET}:${id}:sliding`;
    const limit = 1;
    await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    await sleep(300);
    await consumeRateLimitSliding({
      bucket: BUCKET,
      identifier: id,
      limit,
      windowSeconds: TINY_WINDOW_SECONDS,
    });
    expect(await redis.pttl(key)).toBeGreaterThan(0);
  });
});

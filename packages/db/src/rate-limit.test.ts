import {
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";

// In-memory fake of the redis surface used by the rate limiter: INCR/EXPIRE
// pipelines, SET NX for one-shot claims, and a small sorted-set engine for the
// sliding window's ZREMRANGEBYSCORE / ZADD / ZCARD / ZRANGE sequence.
//
// The sorted set is modelled properly rather than as a counter, because the whole
// point of a sliding window is that a hit expires `windowSeconds` after it
// HAPPENED. A counter fake would make the boundary-burst property untestable,
// which is the one property the sliding helper exists for.
const counters = new Map<string, number>();
const claims = new Set<string>();
// key -> sorted list of [score, member], kept sorted by score ascending.
const sortedSets = new Map<string, [number, string][]>();
// A pinned clock, because the sliding window reads Date.now() and every property
// under test - expiry, retry-after, the absence of a boundary - is a statement
// about WHEN a hit happened. A real clock would make them flaky rather than
// precise.
const CLOCK_START = 1_800_000_000_000;

function resetFake() {
  counters.clear();
  claims.clear();
  sortedSets.clear();
  setSystemTime(new Date(CLOCK_START));
}

function zremrangebyscore(key: string, min: number, max: number) {
  const entries = sortedSets.get(key) ?? [];
  const kept = entries.filter(([score]) => {
    if (min === Number.NEGATIVE_INFINITY) {
      return score > max;
    }
    return score < min || score > max;
  });
  sortedSets.set(key, kept);
  return kept.length;
}

function zadd(key: string, score: number, member: string) {
  const entries = (sortedSets.get(key) ?? []).filter(
    (entry) => entry[1] !== member
  );
  entries.push([score, member]);
  entries.sort((a, b) => a[0] - b[0]);
  sortedSets.set(key, entries);
  return 1;
}

function zcard(key: string) {
  return (sortedSets.get(key) ?? []).length;
}

function zrangeWithScores(key: string) {
  return (sortedSets.get(key) ?? []).flatMap(([score, member]) => [
    member,
    String(score),
  ]);
}

class FakeIoRedis {
  status = "ready";
  // Simulates a redis outage for fail-open tests.
  static failing = false;

  pipeline = () => {
    if (this.status === "end" || FakeIoRedis.failing) {
      throw new Error("connection refused");
    }
    const ops: (() => [Error | null, unknown])[] = [];
    const p = {
      exec: () => Promise.all(ops.map((op) => op())),
      expire: (_key: string, _ttl: number) => {
        ops.push(() => [null, 1]);
        return p;
      },
      incr: (key: string) => {
        ops.push(() => {
          const next = (counters.get(key) ?? 0) + 1;
          counters.set(key, next);
          return [null, next];
        });
        return p;
      },
    };
    return p;
  };

  // The sliding window is one Lua script, so the fake runs the same script
  // against the same helpers above rather than pretending a command sequence
  // happened. That keeps the test honest about WHICH operations the script
  // performs - dropping expired members, counting, adding, trimming.
  eval = (_script: string, _numKeys: number, ...args: unknown[]): unknown => {
    if (this.status === "end" || FakeIoRedis.failing) {
      throw new Error("connection refused");
    }
    const [key, rawLimit, rawWindowMs, rawNow, member] = args as [
      string,
      number,
      number,
      number,
      string,
    ];
    const limit = Number(rawLimit);
    const windowMs = Number(rawWindowMs);
    const now = Number(rawNow);
    zremrangebyscore(key, Number.NEGATIVE_INFINITY, now - windowMs);
    const count = zcard(key);
    if (count < limit) {
      zadd(key, now, String(member));
      return [1, limit - count - 1, now + windowMs];
    }
    const oldest = zrangeWithScores(key);
    const retryAt =
      oldest.length > 1 ? Number(oldest[1]) + windowMs : now + windowMs;
    return [0, 0, retryAt];
  };

  set = (
    key: string,
    _value: string,
    _mode: "EX",
    _ttl: number,
    nx: "NX"
  ): string | null => {
    if (this.status === "end" || FakeIoRedis.failing) {
      throw new Error("connection refused");
    }
    if (nx !== "NX") {
      return "OK";
    }
    if (claims.has(key)) {
      return null;
    }
    claims.add(key);
    return "OK";
  };
}

mock.module("ioredis", () => ({ default: FakeIoRedis }));

const {
  consumeRateLimit,
  consumeRateLimitSliding,
  getClientIpFromRequest,
  hashViewerId,
} = await import("./rate-limit");
const { claimOnce } = await import("./redis");

const LIMIT_ONE = { bucket: "t", identifier: "a", limit: 5, windowSeconds: 60 };

describe("consumeRateLimit", () => {
  beforeEach(() => {
    resetFake();
    FakeIoRedis.failing = false;
  });

  test("allows requests under the limit and reports remaining budget", async () => {
    const first = await consumeRateLimit({
      bucket: "test",
      identifier: "ip-1",
      limit: 3,
      windowSeconds: 60,
    });
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    await consumeRateLimit({
      bucket: "test",
      identifier: "ip-1",
      limit: 3,
      windowSeconds: 60,
    });
    const third = await consumeRateLimit({
      bucket: "test",
      identifier: "ip-1",
      limit: 3,
      windowSeconds: 60,
    });
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  test("blocks the request that exceeds the limit", async () => {
    const hits = [
      await consumeRateLimit(LIMIT_ONE),
      await consumeRateLimit(LIMIT_ONE),
      await consumeRateLimit(LIMIT_ONE),
      await consumeRateLimit(LIMIT_ONE),
      await consumeRateLimit(LIMIT_ONE),
    ];
    expect(hits.every((hit) => hit.allowed)).toBe(true);

    const sixth = await consumeRateLimit(LIMIT_ONE);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("tracks identifiers independently", async () => {
    await consumeRateLimit({
      bucket: "t",
      identifier: "x",
      limit: 1,
      windowSeconds: 60,
    });
    const blocked = await consumeRateLimit({
      bucket: "t",
      identifier: "x",
      limit: 1,
      windowSeconds: 60,
    });
    const otherOk = await consumeRateLimit({
      bucket: "t",
      identifier: "y",
      limit: 1,
      windowSeconds: 60,
    });
    expect(blocked.allowed).toBe(false);
    expect(otherOk.allowed).toBe(true);
  });

  test("fails open when redis is unavailable", async () => {
    FakeIoRedis.failing = true;
    const result = await consumeRateLimit({
      bucket: "t",
      identifier: "z",
      limit: 1,
      windowSeconds: 60,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("claimOnce", () => {
  beforeEach(() => {
    resetFake();
    FakeIoRedis.failing = false;
  });

  test("first claim wins, second claim loses", async () => {
    const key = "seen:post1:u1";
    expect(await claimOnce(key, 3600)).toBe(true);
    expect(await claimOnce(key, 3600)).toBe(false);
  });

  test("different keys claim independently", async () => {
    expect(await claimOnce("k1", 60)).toBe(true);
    expect(await claimOnce("k2", 60)).toBe(true);
  });

  test("fails open when redis is unavailable", async () => {
    FakeIoRedis.failing = true;
    expect(await claimOnce("unreachable", 60)).toBe(true);
  });
});

describe("hashViewerId", () => {
  test("produces stable, non-reversible short ids", () => {
    expect(hashViewerId("1.2.3.4")).toBe(hashViewerId("1.2.3.4"));
    expect(hashViewerId("1.2.3.4")).not.toBe(hashViewerId("1.2.3.5"));
    expect(hashViewerId("1.2.3.4")).toHaveLength(24);
    expect(hashViewerId("1.2.3.4")).not.toContain("1.2.3.4");
  });
});

describe("getClientIpFromRequest", () => {
  test("prefers cf-connecting-ip", () => {
    const request = new Request("https://x.test/", {
      headers: {
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "10.0.0.1, 10.0.0.2",
      },
    });
    expect(getClientIpFromRequest(request)).toBe("203.0.113.7");
  });

  test("falls back to the first x-forwarded-for entry", () => {
    const request = new Request("https://x.test/", {
      headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" },
    });
    expect(getClientIpFromRequest(request)).toBe("10.0.0.1");
  });

  test("falls back to x-real-ip then unknown", () => {
    const real = new Request("https://x.test/", {
      headers: { "x-real-ip": "192.0.2.9" },
    });
    expect(getClientIpFromRequest(real)).toBe("192.0.2.9");
    expect(getClientIpFromRequest(new Request("https://x.test/"))).toBe(
      "unknown"
    );
  });
});

describe("consumeRateLimitSliding", () => {
  const TYPING = {
    bucket: "typing",
    identifier: "u1",
    limit: 3,
    windowSeconds: 10,
  };

  // Every shape of assertion below is "was this allowed", so one helper that
  // answers that keeps the tests free of await-in-loop and of reading a member
  // straight off an await.
  async function allowed(options: typeof TYPING): Promise<boolean> {
    const result = await consumeRateLimitSliding(options);
    return result.allowed;
  }

  // Fires `count` requests at the same pinned instant. The clock is not moved
  // between them, which is the point: two hits in the same millisecond have to
  // count as two.
  async function burst(
    options: typeof TYPING,
    count: number
  ): Promise<boolean[]> {
    const results = await Promise.all(
      Array.from({ length: count }, () => allowed(options))
    );
    return results;
  }

  beforeEach(() => {
    resetFake();
    FakeIoRedis.failing = false;
  });

  test("allows up to the limit and reports the remaining budget", async () => {
    const first = await consumeRateLimitSliding(TYPING);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
    const second = await consumeRateLimitSliding(TYPING);
    expect(second.remaining).toBe(1);
    const third = await consumeRateLimitSliding(TYPING);
    expect(third.remaining).toBe(0);
  });

  test("refuses the request past the limit, with a retry-after that points at the oldest hit", async () => {
    expect(await burst(TYPING, 3)).toEqual([true, true, true]);
    const refused = await consumeRateLimitSliding(TYPING);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    // The first hit was at the pinned clock, so its slot frees exactly one window
    // later - a whole window after the last ACCEPTED hit, not after the refusal.
    expect(refused.resetAt).toBe(CLOCK_START + 10_000);
    expect(refused.retryAfterSeconds).toBe(10);
  });

  test("refused hits are not recorded, so hammering does not extend the lockout", async () => {
    // The difference from a fixed window that matters: a client retrying every
    // 100ms against a closed bucket does not push its own release further out.
    const options = { ...TYPING, limit: 2 };
    setSystemTime(new Date(CLOCK_START + 1000));
    expect(await allowed(options)).toBe(true);
    setSystemTime(new Date(CLOCK_START + 2000));
    expect(await allowed(options)).toBe(true);
    const refusals = await burst(options, 25);
    expect(refusals.every((wasAllowed) => !wasAllowed)).toBe(true);

    // The t=1s hit frees its slot at t=11s, not at t=27s, which is where the last
    // REFUSED request would have put it if refusals were recorded.
    setSystemTime(new Date(CLOCK_START + 10_999));
    expect(await allowed(options)).toBe(false);
    setSystemTime(new Date(CLOCK_START + 11_001));
    expect(await allowed(options)).toBe(true);
    // Exactly one slot came back, not two.
    setSystemTime(new Date(CLOCK_START + 11_002));
    expect(await allowed(options)).toBe(false);
  });

  test("there is no window boundary to burst across", async () => {
    // The property a fixed window cannot provide, stated as the number a fixed
    // window would have allowed. Nineteen hits land in the last 100ms of the
    // window; a fixed counter then rolls over and hands out the whole budget
    // again, so the caller gets 39 where the stated limit is 20.
    const options = {
      bucket: "send",
      identifier: "u1",
      limit: 20,
      windowSeconds: 10,
    };
    const beforeBoundary: boolean[] = [];
    for (let index = 0; index < 19; index += 1) {
      setSystemTime(new Date(CLOCK_START + 9900 + index * 5));
      // oxlint-disable-next-line no-await-in-loop -- each hit lands at its own pinned instant, so the sequence is the thing under test
      beforeBoundary.push(await allowed(options));
    }
    expect(beforeBoundary).toEqual(Array.from({ length: 19 }, () => true));

    // Straddling the boundary buys exactly one more hit, not twenty.
    setSystemTime(new Date(CLOCK_START + 10_020));
    expect(await allowed(options)).toBe(true);
    const afterBoundary: boolean[] = [];
    for (let index = 0; index < 5; index += 1) {
      setSystemTime(new Date(CLOCK_START + 10_030 + index * 5));
      // oxlint-disable-next-line no-await-in-loop -- each hit lands at its own pinned instant
      afterBoundary.push(await allowed(options));
    }
    expect(afterBoundary).toEqual([false, false, false, false, false]);
  });

  test("budget returns one hit at a time as the window rolls forward", async () => {
    const options = { ...TYPING, limit: 2 };
    setSystemTime(new Date(CLOCK_START));
    expect(await allowed(options)).toBe(true);
    setSystemTime(new Date(CLOCK_START + 5000));
    expect(await allowed(options)).toBe(true);
    setSystemTime(new Date(CLOCK_START + 5001));
    expect(await allowed(options)).toBe(false);
    // The first hit aged out; exactly one slot came back, not two.
    setSystemTime(new Date(CLOCK_START + 10_001));
    expect(await allowed(options)).toBe(true);
    setSystemTime(new Date(CLOCK_START + 10_002));
    expect(await allowed(options)).toBe(false);
  });

  test("identifiers are independent", async () => {
    const options = { ...TYPING, limit: 1, windowSeconds: 60 };
    expect(await allowed(options)).toBe(true);
    expect(await allowed(options)).toBe(false);
    expect(await allowed({ ...options, identifier: "u2" })).toBe(true);
  });

  test("buckets are independent", async () => {
    const options = { identifier: "u1", limit: 1, windowSeconds: 60 };
    expect(await allowed({ ...options, bucket: "typing" })).toBe(true);
    expect(await allowed({ ...options, bucket: "typing" })).toBe(false);
    expect(await allowed({ ...options, bucket: "send" })).toBe(true);
  });

  test("two hits in the same millisecond are two hits", async () => {
    // The member has to be unique or ZADD collapses them into one entry and the
    // window under-counts itself. This is the test for that, and it is why the
    // helper above fires without moving the clock.
    const options = {
      bucket: "send",
      identifier: "u1",
      limit: 2,
      windowSeconds: 60,
    };
    setSystemTime(new Date(CLOCK_START));
    expect(await burst(options, 2)).toEqual([true, true]);
    expect(await allowed(options)).toBe(false);
  });

  test("fails open when redis is unavailable", async () => {
    // Same rule as every limiter in the app: a Redis outage must not take the
    // product down for real users. Cloudflare is the volumetric backstop.
    FakeIoRedis.failing = true;
    const result = await consumeRateLimitSliding({
      bucket: "send",
      identifier: "u1",
      limit: 1,
      windowSeconds: 60,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(result.retryAfterSeconds).toBe(0);
  });
});

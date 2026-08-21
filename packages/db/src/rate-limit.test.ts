import { beforeEach, describe, expect, mock, test } from "bun:test";

// In-memory fake of the redis surface used by the rate limiter: INCR/EXPIRE
// pipelines and SET NX for one-shot claims.
const counters = new Map<string, number>();
const claims = new Set<string>();

function resetFake() {
  counters.clear();
  claims.clear();
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

const { consumeRateLimit, getClientIpFromRequest, hashViewerId } =
  await import("./rate-limit");
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

import { beforeEach, describe, expect, mock, test } from "bun:test";

// Fake ioredis client exposing just the pipeline surface the redis store
// uses (INCR + EXPIRE), with an injectable failure mode for fail-open tests.
const counters = new Map<string, number>();

function resetFake() {
  counters.clear();
}

class FakePipeline {
  ops: (() => [Error | null, unknown])[] = [];
  exec() {
    return Promise.all(this.ops.map((op) => op()));
  }
  incr(key: string) {
    this.ops.push(() => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return [null, next];
    });
    return this;
  }
  expire(_key: string, _ttl: number) {
    this.ops.push(() => [null, 1]);
    return this;
  }
}

let failing = false;

const fakeClient = {
  pipeline() {
    if (failing) {
      throw new Error("connection refused");
    }
    return new FakePipeline();
  },
};

mock.module("@asm/logger", () => ({
  createLogger: () => ({
    error: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

const { createRedisRateLimitStore } = await import("./redis-store");

describe("createRedisRateLimitStore", () => {
  beforeEach(() => {
    resetFake();
    failing = false;
  });

  test("counts hits within a window and trips at max", async () => {
    const store = createRedisRateLimitStore(() => fakeClient as never);
    const now = 1_000_000;

    // Sequential hits are the point: each request consumes budget.
    const first = await store.hit("anon:1.2.3.4", 60_000, 3, now);
    const second = await store.hit("anon:1.2.3.4", 60_000, 3, now);
    const third = await store.hit("anon:1.2.3.4", 60_000, 3, now);
    expect([first, second, third].every((result) => !result.hit)).toBe(true);

    const fourth = await store.hit("anon:1.2.3.4", 60_000, 3, now);
    expect(fourth.hit).toBe(true);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("separates keys by limiter and window bucket", async () => {
    const store = createRedisRateLimitStore(() => fakeClient as never);
    const windowMs = 60_000;
    const early = 0;
    const late = windowMs + 1;

    await store.hit("burst:5.5.5.5", windowMs, 1, early);
    const sameWindow = await store.hit(
      "burst:5.5.5.5",
      windowMs,
      1,
      early + 1000
    );
    expect(sameWindow.hit).toBe(true);

    // A later window bucket is a fresh counter.
    const nextWindow = await store.hit("burst:5.5.5.5", windowMs, 1, late);
    expect(nextWindow.hit).toBe(false);
  });

  test("fails open when redis throws", async () => {
    failing = true;
    const store = createRedisRateLimitStore(() => fakeClient as never);
    const result = await store.hit("anon:9.9.9.9", 60_000, 1, 1_000_000);
    expect(result.hit).toBe(false);
  });
});

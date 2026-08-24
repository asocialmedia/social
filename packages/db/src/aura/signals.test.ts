import { beforeEach, describe, expect, mock, test } from "bun:test";

import { invalidateAuraSignals } from "./signals";
import type { AuraSignals } from "./signals";

// Fakes for the two IO dependencies of the signals module. Registered via
// mock.module before the dynamic import so the real Prisma/Redis never load.
// Signatures are deliberately wide so tests can re-point them per case.
const fakePrisma = {
  auraLog: {
    findMany: (): Promise<{ amount: number; createdAt: Date }[]> =>
      Promise.resolve([]),
  },
  user: {
    findUnique: (): Promise<{ aura: number; createdAt: Date } | null> =>
      Promise.resolve(null),
  },
};
const fakeRedis = {
  del: (..._keys: string[]) => Promise.resolve(1),
  get: (_key: string) => Promise.resolve<string | null>(null),
  setex: (_key: string, _ttl: number, _value: string) => Promise.resolve("OK"),
};

mock.module("../prisma", () => ({ default: fakePrisma }));
mock.module("../redis", () => ({ redis: fakeRedis }));

const { computeAuraSignals, getAuraSignalsForUsers } =
  await import("./signals");

const NOW = new Date("2026-08-24T12:00:00Z");

function configureFakes(
  options: {
    cached?: string | null;
    entries?: { amount: number; createdAt: Date }[];
    setexShouldFail?: boolean;
    user?: { aura: number; createdAt: Date } | null;
  } = {}
) {
  const calls = {
    cacheWrites: [] as string[],
    deletedKeys: [] as string[],
  };

  fakePrisma.user.findUnique = () => Promise.resolve(options.user ?? null);
  fakePrisma.auraLog.findMany = () => Promise.resolve(options.entries ?? []);
  fakeRedis.get = () => Promise.resolve(options.cached ?? null);
  fakeRedis.setex = (key: string, _ttl: number, value: string) => {
    if (options.setexShouldFail) {
      return Promise.reject(new Error("cache down"));
    }
    calls.cacheWrites.push(`${key}=${value}`);
    return Promise.resolve("OK");
  };
  fakeRedis.del = (...keys: string[]) => {
    calls.deletedKeys.push(...keys);
    return Promise.resolve(keys.length);
  };

  return calls;
}

describe("computeAuraSignals", () => {
  test("builds the full signal bundle from the ledger", async () => {
    configureFakes({
      entries: [
        { amount: 10, createdAt: new Date(NOW.getTime() - 3_600_000) },
        { amount: -4, createdAt: new Date(NOW.getTime() - 86_400_000) },
      ],
      user: {
        aura: 2500,
        createdAt: new Date(NOW.getTime() - 90 * 86_400_000),
      },
    });

    const signals = await computeAuraSignals("u1");

    expect(signals?.lifetimeAura).toBe(2500);
    // Mature account with a healthy (not yet veteran) balance: high
    // credibility but still under saturation on the log-scaled aura half.
    expect(signals?.credibility).toBeGreaterThan(0.9);
    expect(signals?.credibility).toBeLessThan(1);
    // Positive balance is fully visible.
    expect(signals?.visibilityWeight).toBe(1);
    // Both entries land inside the freshest 48h bucket (weight 1):
    // +10 recent earnings minus the -4 penalty.
    expect(signals?.momentum).toBeCloseTo(6, 5);
  });

  test("unknown users yield null", async () => {
    configureFakes({ user: null });
    const ghost = await computeAuraSignals("ghost");
    expect(ghost).toBeNull();
  });
});

describe("getAuraSignals caching", () => {
  beforeEach(() => {
    configureFakes();
  });

  test("writes through on miss and serves later reads from cache", async () => {
    const signalsBundle: AuraSignals = {
      credibility: 0.9,
      lifetimeAura: 4200,
      momentum: 12,
      visibilityWeight: 1,
    };
    let reads = 0;
    configureFakes({ cached: null });
    fakePrisma.user.findUnique = () => {
      reads += 1;
      return Promise.resolve({ aura: 4200, createdAt: new Date(0) });
    };
    fakeRedis.get = () =>
      Promise.resolve(reads > 0 ? JSON.stringify(signalsBundle) : null);

    const first = await getAuraSignalsForUsers(["u-cache"]);
    expect(first.get("u-cache")?.lifetimeAura).toBe(4200);

    // Second lookup hits the cache path: no additional ledger read.
    const before = reads;
    const second = await getAuraSignalsForUsers(["u-cache"]);
    expect(second.get("u-cache")).toEqual(signalsBundle);
    expect(reads).toBe(before);
  });

  test("a cache write failure is swallowed (fail-open)", async () => {
    configureFakes({
      setexShouldFail: true,
      user: { aura: 100, createdAt: new Date(0) },
    });

    const signals = await getAuraSignalsForUsers(["u1"]);
    expect(signals.get("u1")?.lifetimeAura).toBe(100);
  });
});

describe("invalidateAuraSignals", () => {
  test("deletes the mapped cache keys", async () => {
    const calls = configureFakes();

    await invalidateAuraSignals(["a", "b"]);

    expect(calls.deletedKeys).toEqual(["aura:signals:a", "aura:signals:b"]);
  });
});

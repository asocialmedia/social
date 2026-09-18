import { beforeEach, describe, expect, mock, test } from "bun:test";

// The invalidators only touch Redis; the service behind the cached readers is
// mocked out so importing the module never pulls Prisma into the suite.
const fakeRedis = {
  del: (..._keys: string[]) => Promise.resolve(1),
  get: (_key: string) => Promise.resolve<string | null>(null),
  set: (_key: string, _value: string, ..._args: (string | number)[]) =>
    Promise.resolve("OK"),
};

mock.module("../redis", () => ({ claimOnce: () => true, redis: fakeRedis }));
// The cache module imports these readers from ./service; stub each by name so
// the module graph loads without Prisma. None is called by the invalidators.
mock.module("./service", () => ({
  getCommunityCategoryCounts: () => Promise.resolve({}),
  getCommunityDiscoveryStats: () => Promise.resolve({}),
  getCommunitySections: () => Promise.resolve({ growing: [], trending: [] }),
  getCommunityStats: () => Promise.resolve({}),
  getMostActiveCategory: () => Promise.resolve(null),
  getTopCommunities: () => Promise.resolve([]),
  getTopCommunitiesByAura: () => Promise.resolve([]),
}));

const {
  invalidateCommunityCreationAggregates,
  invalidateCommunityPopulationAggregates,
  invalidateCommunityStats,
} = await import("./aura");

function captureDeletes() {
  const deleted: string[] = [];
  fakeRedis.del = (...keys: string[]) => {
    deleted.push(...keys);
    return Promise.resolve(keys.length);
  };
  return deleted;
}

describe("community aggregate invalidation", () => {
  beforeEach(() => {
    fakeRedis.del = () => Promise.resolve(1);
  });

  test("drops the community's own stats key and its stale fallback", async () => {
    const deleted = captureDeletes();
    await invalidateCommunityStats("c1");
    expect(deleted).toContain("community:stats:c1");
    expect(deleted).toContain("community:stats:c1:stale");
  });

  test("a population change drops the discovery hero member total", async () => {
    const deleted = captureDeletes();
    await invalidateCommunityPopulationAggregates();
    // The discovery stats key is what the hero's Members figure reads; without
    // it a joiner stayed invisible until the 120s TTL expired.
    expect(deleted).toContain("community:discovery-stats");
    expect(deleted).toContain("community:discovery-stats:stale");
    expect(deleted).toContain("community:sections");
    expect(deleted).toContain("community:top-by-population");
  });

  test("creation drops the category counts as well", async () => {
    const deleted = captureDeletes();
    await invalidateCommunityCreationAggregates();
    expect(deleted).toContain("community:category-counts");
    expect(deleted).toContain("community:discovery-stats");
    expect(deleted).toContain("community:sections");
    expect(deleted).toContain("community:top-by-aura");
  });
});

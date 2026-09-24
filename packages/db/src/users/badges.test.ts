import { beforeEach, describe, expect, mock, test } from "bun:test";

interface UserBadgeRow {
  aura?: number;
  badge: string | null;
  badges: string[];
  followsFollows?: number;
  id?: string;
}

interface CollectionMock {
  aggregate: (fn: (aggregate: { count: () => number }) => unknown) => Promise<{
    count: number;
  }>;
  all: () => Promise<UserBadgeRow[]>;
  first: () => Promise<UserBadgeRow | null>;
  include: (
    relation: string,
    fn: (collection: CollectionMock) => unknown
  ) => CollectionMock;
  limit: (value: number) => CollectionMock;
  orderBy: (fn: (model: unknown) => unknown) => CollectionMock;
  select: (...fields: string[]) => CollectionMock;
  update: (data: Record<string, unknown>) => Promise<UserBadgeRow>;
  where: (predicate: unknown) => CollectionMock;
}

const userFirstResults: (UserBadgeRow | null)[] = [];
const userAllResults: UserBadgeRow[][] = [];
const postCounts: number[] = [];
const userUpdates: Record<string, unknown>[] = [];
const userUpdateErrors: (Error | null)[] = [];

function createUserCollection(): CollectionMock {
  const collection: CollectionMock = {
    aggregate: mock(() => Promise.resolve({ count: 0 })),
    all: mock(() => Promise.resolve(userAllResults.shift() ?? [])),
    first: mock(() => Promise.resolve(userFirstResults.shift() ?? null)),
    include: mock(() => collection),
    limit: mock(() => collection),
    orderBy: mock(() => collection),
    select: mock(() => collection),
    update: mock((data) => {
      const failure = userUpdateErrors.shift();
      if (failure) {
        return Promise.reject(failure);
      }
      userUpdates.push(data);
      return Promise.resolve({
        badge: null,
        badges: [],
        id: "updated",
      });
    }),
    where: mock(() => collection),
  };
  return collection;
}

function createPostCollection(): CollectionMock {
  const collection: CollectionMock = {
    aggregate: mock(() => Promise.resolve({ count: postCounts.shift() ?? 0 })),
    all: mock(() => Promise.resolve([])),
    first: mock(() => Promise.resolve(null)),
    include: mock(() => collection),
    limit: mock(() => collection),
    orderBy: mock(() => collection),
    select: mock(() => collection),
    update: mock(() => Promise.resolve({ badge: null, badges: [] })),
    where: mock(() => collection),
  };
  return collection;
}

const userCollection = createUserCollection();
const postCollection = createPostCollection();
const prismaMock = {
  orm: {
    public: {
      Posts: {
        select: postCollection.select,
        where: postCollection.where,
      },
      Users: {
        select: userCollection.select,
        where: userCollection.where,
      },
    },
  },
};

mock.module("../prisma", () => ({
  default: prismaMock,
  toPrismaDateTime: (value: Date) =>
    Temporal.PlainDateTime.from(value.toISOString().replace("Z", "")),
}));

beforeEach(() => {
  for (const collection of [userCollection, postCollection]) {
    for (const method of Object.values(collection)) {
      method.mockClear();
    }
  }
  userFirstResults.length = 0;
  userAllResults.length = 0;
  postCounts.length = 0;
  userUpdates.length = 0;
  userUpdateErrors.length = 0;
});

describe("getUserBadges", () => {
  test("returns the badges array when present", async () => {
    const { getUserBadges } = await import("./badges");

    expect(
      getUserBadges({ badge: "dev", badges: ["dev", "shitposter"] })
    ).toEqual(["dev", "shitposter"]);
  });

  test("falls back to the legacy single badge when the array is empty", async () => {
    const { getUserBadges } = await import("./badges");

    expect(getUserBadges({ badge: "author", badges: [] })).toEqual(["author"]);
    expect(getUserBadges({ badge: "author" })).toEqual(["author"]);
  });

  test("merges the legacy badge with the array and orders by precedence", async () => {
    const { getUserBadges } = await import("./badges");

    expect(
      getUserBadges({ badge: "author", badges: ["early", "author"] })
    ).toEqual(["author", "early"]);
  });

  test("dedupes values and returns an empty list for no badges", async () => {
    const { getUserBadges } = await import("./badges");

    expect(getUserBadges({ badge: null, badges: ["dev", "dev"] })).toEqual([
      "dev",
    ]);
    expect(getUserBadges({ badge: null, badges: [] })).toEqual([]);
  });
});

describe("grantBadge", () => {
  test("returns false when the user already holds the badge", async () => {
    const { grantBadge } = await import("./badges");
    userFirstResults.push({ badge: null, badges: ["shitposter"] });

    expect(await grantBadge("u1", "shitposter")).toBe(false);
    expect(userUpdates).toHaveLength(0);
  });

  test("throws BadgeLimitError when a legacy author exists", async () => {
    const { BadgeLimitError, grantBadge } = await import("./badges");
    userFirstResults.push({ badge: "author", badges: [] });

    await expect(grantBadge("u1", "author")).rejects.toThrow(BadgeLimitError);
    expect(userUpdates).toHaveLength(0);
  });

  test("maps a global author unique violation to BadgeLimitError", async () => {
    const { BadgeLimitError, grantBadge } = await import("./badges");
    userFirstResults.push(null, { badge: null, badges: [] });
    userUpdateErrors.push(
      Object.assign(new Error("conflict"), { code: "P2002" })
    );

    await expect(grantBadge("u1", "author")).rejects.toThrow(BadgeLimitError);
  });

  test("appends the badge when not held", async () => {
    const { grantBadge } = await import("./badges");
    userFirstResults.push({ badge: null, badges: [] });

    expect(await grantBadge("u1", "dev")).toBe(true);
    expect(userUpdates.at(-1)?.badges).toEqual(["dev"]);
  });

  test("materializes the legacy badge into the array", async () => {
    const { grantBadge } = await import("./badges");
    userFirstResults.push({ badge: "author", badges: [] });

    await grantBadge("u1", "shitposter");
    expect(userUpdates.at(-1)?.badges).toEqual(["author", "shitposter"]);
  });
});

describe("revokeBadge", () => {
  test("removes a badge from the array", async () => {
    const { revokeBadge } = await import("./badges");
    userFirstResults.push({ badge: null, badges: ["dev", "early"] });

    expect(await revokeBadge("u1", "early")).toBe(true);
    expect(userUpdates.at(-1)).toMatchObject({
      badge: null,
      badges: ["dev"],
    });
  });

  test("removes a legacy-only badge", async () => {
    const { revokeBadge } = await import("./badges");
    userFirstResults.push({ badge: "dev", badges: [] });

    expect(await revokeBadge("u1", "dev")).toBe(true);
    expect(userUpdates.at(-1)).toMatchObject({ badge: null, badges: [] });
  });

  test("returns false when the badge is absent", async () => {
    const { revokeBadge } = await import("./badges");
    userFirstResults.push({ badge: null, badges: ["early"] });

    expect(await revokeBadge("u1", "dev")).toBe(false);
    expect(userUpdates).toHaveLength(0);
  });

  test("returns false for a missing user", async () => {
    const { revokeBadge } = await import("./badges");

    expect(await revokeBadge("missing", "dev")).toBe(false);
  });

  test("rejects revoking the author badge", async () => {
    const { BadgeLimitError, revokeBadge } = await import("./badges");

    await expect(revokeBadge("u1", "author")).rejects.toThrow(BadgeLimitError);
  });
});

describe("qualified badges", () => {
  test("grants shitposter at the recent-post threshold", async () => {
    const { grantShitposterBadgeIfQualified } = await import("./badges");
    userFirstResults.push(
      { badge: null, badges: [] },
      { badge: null, badges: [] }
    );
    postCounts.push(5);

    expect(await grantShitposterBadgeIfQualified("u1")).toBe(true);
    expect(userUpdates.at(-1)?.badges).toEqual(["shitposter"]);
  });

  test("does not grant shitposter below the threshold", async () => {
    const { grantShitposterBadgeIfQualified } = await import("./badges");
    userFirstResults.push({ badge: null, badges: [] });
    postCounts.push(4);

    expect(await grantShitposterBadgeIfQualified("u1")).toBe(false);
    expect(userUpdates).toHaveLength(0);
  });

  test("does not re-grant shitposter", async () => {
    const { grantShitposterBadgeIfQualified } = await import("./badges");
    userFirstResults.push({ badge: null, badges: ["shitposter"] });

    expect(await grantShitposterBadgeIfQualified("u1")).toBe(false);
  });

  test("grants early at the aura threshold", async () => {
    const { grantEarlyBadgeIfQualified, EARLY_AURA_THRESHOLD } =
      await import("./badges");
    userFirstResults.push(
      {
        aura: EARLY_AURA_THRESHOLD,
        badge: null,
        badges: [],
      },
      { badge: null, badges: [] }
    );

    expect(await grantEarlyBadgeIfQualified("u1")).toBe(true);
  });

  test("refuses early badges after the deadline", async () => {
    const { grantEarlyBadgeIfQualified, EARLY_DEADLINE } =
      await import("./badges");

    expect(
      await grantEarlyBadgeIfQualified(
        "u1",
        new Date(EARLY_DEADLINE.getTime() + 1000)
      )
    ).toBe(false);
  });
});

describe("badge sweeps", () => {
  test("sweep pages through candidates and grants each", async () => {
    const { sweepEarlyBadges } = await import("./badges");
    userAllResults.push([
      { badge: null, badges: [], id: "u1" },
      { badge: null, badges: [], id: "u2" },
    ]);
    userFirstResults.push(
      { badge: null, badges: [] },
      { badge: null, badges: [] }
    );

    expect(await sweepEarlyBadges(new Date("2026-06-01T00:00:00Z"), 200)).toBe(
      2
    );
    expect(userUpdates).toHaveLength(2);
  });

  test("sweep filters existing holders before granting", async () => {
    const { sweepEarlyBadges } = await import("./badges");
    userAllResults.push([{ badge: null, badges: ["early"], id: "u1" }]);

    expect(await sweepEarlyBadges(new Date("2026-06-01T00:00:00Z"))).toBe(0);
    expect(userUpdates).toHaveLength(0);
  });

  test("sync grants the new cohort and revokes dropped holders", async () => {
    const { syncTrendingBadges } = await import("./badges");
    userAllResults.push([
      { badge: null, badges: ["trending"], id: "old" },
      { badge: null, badges: ["trending"], id: "stays" },
    ]);
    userFirstResults.push(
      { badge: null, badges: [] },
      { badge: null, badges: ["trending"] }
    );

    expect(await syncTrendingBadges(["stays", "fresh"])).toEqual({
      granted: 1,
      revoked: 1,
    });
  });

  test("sync revokes every holder for an empty cohort", async () => {
    const { syncTrendingBadges } = await import("./badges");
    userAllResults.push([
      { badge: null, badges: ["trending"], id: "a" },
      { badge: null, badges: ["trending"], id: "b" },
    ]);
    userFirstResults.push(
      { badge: null, badges: ["trending"] },
      { badge: null, badges: ["trending"] }
    );

    expect(await syncTrendingBadges([])).toEqual({ granted: 0, revoked: 2 });
  });

  test("sync is a no-op when the cohort already matches", async () => {
    const { syncTrendingBadges } = await import("./badges");
    userAllResults.push([{ badge: null, badges: ["trending"], id: "a" }]);

    expect(await syncTrendingBadges(["a"])).toEqual({
      granted: 0,
      revoked: 0,
    });
    expect(userUpdates).toHaveLength(0);
  });
});

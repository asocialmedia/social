import { beforeEach, describe, expect, mock, test } from "bun:test";

interface UserBadgeRow {
  aura?: number;
  badge: string | null;
  badges: string[];
}

const prismaMock = {
  post: {
    count: mock((): Promise<number> => Promise.resolve(0)),
  },
  user: {
    count: mock((): Promise<number> => Promise.resolve(0)),
    findFirst: mock((): Promise<{ id: string } | null> =>
      Promise.resolve(null)
    ),
    findMany: mock((): Promise<{ id: string }[]> => Promise.resolve([])),
    // Takes the query args so tests can answer per-id (grant/revoke re-read the
    // row before writing, so the same mock serves several ids in one call).
    findUnique: mock(
      (_args?: { where?: { id?: string } }): Promise<UserBadgeRow | null> =>
        Promise.resolve(null)
    ),
    update: mock((): Promise<{ id: string }> => Promise.resolve({ id: "u" })),
  },
};

mock.module("../prisma", () => ({ default: prismaMock }));

beforeEach(() => {
  for (const methods of Object.values(prismaMock)) {
    for (const method of Object.values(methods)) {
      method.mockClear();
    }
  }
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.update.mockResolvedValue({ id: "u" });
  prismaMock.post.count.mockResolvedValue(0);
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

    // Legacy author + array early => author leads (highest precedence).
    expect(getUserBadges({ badge: "author", badges: ["early"] })).toEqual([
      "author",
      "early",
    ]);
    // Array already has both, legacy column repeats -> dedupe keeps one.
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

    prismaMock.user.findUnique.mockResolvedValue({
      badge: null,
      badges: ["shitposter"],
    });

    const result = await grantBadge("u1", "shitposter");

    expect(result).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("throws BadgeLimitError when granting author to a second user", async () => {
    const { BadgeLimitError, grantBadge } = await import("./badges");

    prismaMock.user.findFirst.mockResolvedValue({ id: "u0" });

    await expect(grantBadge("u1", "author")).rejects.toThrow(BadgeLimitError);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  test("appends the badge when not held", async () => {
    const { grantBadge } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({ badge: null, badges: [] });

    const result = await grantBadge("u1", "dev");

    expect(result).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      data: { badges: ["dev"] },
      where: { id: "u1" },
    });
  });

  test("materializes the legacy badge into the array when granting a second one", async () => {
    const { grantBadge } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({
      badge: "author",
      badges: [],
    });

    await grantBadge("u1", "shitposter");

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      data: { badges: ["author", "shitposter"] },
      where: { id: "u1" },
    });
  });
});

describe("revokeBadge", () => {
  test("removes a badge from the array", async () => {
    const { revokeBadge } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({
      badge: null,
      badges: ["dev", "early"],
    });

    const result = await revokeBadge("u1", "early");

    expect(result).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      data: { badge: null, badges: ["dev"] },
      where: { id: "u1" },
    });
  });

  test("removes a legacy-only badge and clears the legacy column", async () => {
    const { getUserBadges, revokeBadge } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({
      badge: "dev",
      badges: [],
    });

    const result = await revokeBadge("u1", "dev");

    expect(result).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      data: { badge: null, badges: [] },
      where: { id: "u1" },
    });

    // A later read must not render the revoked badge from either location.
    expect(getUserBadges({ badge: null, badges: [] })).toEqual([]);
  });

  test("returns false when the badge is not present", async () => {
    const { revokeBadge } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({
      badge: null,
      badges: ["early"],
    });

    const result = await revokeBadge("u1", "dev");

    expect(result).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("returns false for a missing user", async () => {
    const { revokeBadge } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await revokeBadge("missing", "dev");

    expect(result).toBe(false);
  });

  test("rejects revoking the author badge", async () => {
    const { BadgeLimitError, revokeBadge } = await import("./badges");

    await expect(revokeBadge("u1", "author")).rejects.toThrow(BadgeLimitError);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("grantShitposterBadgeIfQualified", () => {
  test("grants when recent posts meet the threshold", async () => {
    const { grantShitposterBadgeIfQualified } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({ badge: null, badges: [] });
    prismaMock.post.count.mockResolvedValue(5);

    const result = await grantShitposterBadgeIfQualified("u1");

    expect(result).toBe(true);
    expect(prismaMock.post.count).toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  test("no-ops when below the threshold", async () => {
    const { grantShitposterBadgeIfQualified } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({ badge: null, badges: [] });
    prismaMock.post.count.mockResolvedValue(4);

    const result = await grantShitposterBadgeIfQualified("u1");

    expect(result).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("no-ops when the user already holds the shitposter badge", async () => {
    const { grantShitposterBadgeIfQualified } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({
      badge: null,
      badges: ["shitposter"],
    });

    const result = await grantShitposterBadgeIfQualified("u1");

    expect(result).toBe(false);
    expect(prismaMock.post.count).not.toHaveBeenCalled();
  });

  test("grants when the user has the legacy badge and qualifies", async () => {
    const { grantShitposterBadgeIfQualified } = await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({ badge: "dev", badges: [] });
    prismaMock.post.count.mockResolvedValue(5);

    const result = await grantShitposterBadgeIfQualified("u1");

    expect(result).toBe(true);
  });
});

describe("early badge window", () => {
  test("is open before the deadline and closed at or after it", async () => {
    const { EARLY_DEADLINE, isEarlyBadgeWindowOpen } = await import("./badges");

    expect(isEarlyBadgeWindowOpen(new Date("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isEarlyBadgeWindowOpen(new Date(EARLY_DEADLINE.getTime() - 1))).toBe(
      true
    );
    // The deadline itself is the first closed instant.
    expect(isEarlyBadgeWindowOpen(EARLY_DEADLINE)).toBe(false);
    expect(isEarlyBadgeWindowOpen(new Date("2027-01-01T00:00:00Z"))).toBe(
      false
    );
  });

  test("grantEarlyBadgeIfQualified refuses once the window has closed", async () => {
    const { grantEarlyBadgeIfQualified, EARLY_DEADLINE } =
      await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({ badge: null, badges: [] });

    const result = await grantEarlyBadgeIfQualified(
      "u1",
      new Date(EARLY_DEADLINE.getTime() + 1000)
    );

    expect(result).toBe(false);
    // No user read once the campaign is over: the window check comes first.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  test("grantEarlyBadgeIfQualified refuses below the aura threshold", async () => {
    const { grantEarlyBadgeIfQualified, EARLY_AURA_THRESHOLD } =
      await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({
      aura: EARLY_AURA_THRESHOLD - 1,
      badge: null,
      badges: [],
    });

    expect(await grantEarlyBadgeIfQualified("u1")).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("grantEarlyBadgeIfQualified grants at the threshold", async () => {
    const { grantEarlyBadgeIfQualified, EARLY_AURA_THRESHOLD } =
      await import("./badges");

    prismaMock.user.findUnique.mockResolvedValue({
      aura: EARLY_AURA_THRESHOLD,
      badge: null,
      badges: [],
    });

    expect(await grantEarlyBadgeIfQualified("u1")).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  test("sweep is a no-op once the window has closed", async () => {
    const { sweepEarlyBadges, EARLY_DEADLINE } = await import("./badges");

    const granted = await sweepEarlyBadges(
      new Date(EARLY_DEADLINE.getTime() + 1000)
    );

    expect(granted).toBe(0);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  test("sweep pages through candidates and grants each", async () => {
    const { sweepEarlyBadges } = await import("./badges");

    // One short page, so the sweep terminates after a single pass.
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ badge: null, badges: [] })
      .mockResolvedValueOnce({ badge: null, badges: [] });

    const granted = await sweepEarlyBadges(
      new Date("2026-06-01T00:00:00Z"),
      200
    );

    expect(granted).toBe(2);
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(2);
  });

  test("candidate filter excludes holders by the array, not the nullable column", async () => {
    const { sweepEarlyBadges } = await import("./badges");

    prismaMock.user.findMany.mockResolvedValue([]);
    await sweepEarlyBadges(new Date("2026-06-01T00:00:00Z"));

    // mock.calls entries are argument arrays; the mock takes one args object.
    const calls = prismaMock.user.findMany.mock.calls as unknown as {
      where: Record<string, unknown>;
    }[][];
    const where = calls.at(-1)?.[0]?.where ?? {};
    // Guard against the regression: a NOT over the nullable legacy `badge`
    // column compiles to `NOT (badge = 'early')`, which is NULL (and therefore
    // excludes the row) for every user without a legacy badge - so the sweep
    // silently found nobody. The filter must key off the non-nullable array.
    expect(where).toEqual({
      NOT: { badges: { has: "early" } },
      aura: { gte: 5000 },
    });
    expect(JSON.stringify(where)).not.toContain('"badge"');
  });
});

describe("trending badge sync", () => {
  test("grants to the current cohort and revokes everyone who dropped off", async () => {
    const { syncTrendingBadges } = await import("./badges");

    // The holders query returns the previous cohort. grantBadge/revokeBadge
    // re-read the row before writing, so the mock must answer per id: "old"
    // still holds trending (revocable), "stays" holds it (already correct),
    // "fresh" does not (grantable).
    prismaMock.user.findMany.mockResolvedValue([
      { id: "old" },
      { id: "stays" },
    ]);
    prismaMock.user.findUnique.mockImplementation(
      (args?: { where?: { id?: string } }) =>
        Promise.resolve(
          args?.where?.id === "fresh"
            ? { badge: null, badges: [] }
            : { badge: null, badges: ["trending"] }
        )
    );

    const result = await syncTrendingBadges(["stays", "fresh"]);

    // "fresh" is granted, "old" is revoked, "stays" is left untouched.
    expect(result.granted).toBe(1);
    expect(result.revoked).toBe(1);
  });

  test("an empty cohort revokes every holder", async () => {
    const { syncTrendingBadges } = await import("./badges");

    prismaMock.user.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    prismaMock.user.findUnique.mockResolvedValue({
      badge: null,
      badges: ["trending"],
    });

    const result = await syncTrendingBadges([]);

    expect(result.granted).toBe(0);
    expect(result.revoked).toBe(2);
  });

  test("is a no-op when the cohort already matches the holders", async () => {
    const { syncTrendingBadges } = await import("./badges");

    prismaMock.user.findMany.mockResolvedValue([{ id: "a" }]);

    const result = await syncTrendingBadges(["a"]);

    expect(result).toEqual({ granted: 0, revoked: 0 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

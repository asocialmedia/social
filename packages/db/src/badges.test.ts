import { beforeEach, describe, expect, mock, test } from "bun:test";

interface UserBadgeRow {
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
    findUnique: mock((): Promise<UserBadgeRow | null> => Promise.resolve(null)),
    update: mock((): Promise<{ id: string }> => Promise.resolve({ id: "u" })),
  },
};

mock.module("./prisma", () => ({ default: prismaMock }));

beforeEach(() => {
  for (const methods of Object.values(prismaMock)) {
    for (const method of Object.values(methods)) {
      method.mockClear();
    }
  }
  prismaMock.user.findFirst.mockResolvedValue(null);
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

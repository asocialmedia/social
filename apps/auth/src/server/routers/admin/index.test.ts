import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { Context } from "../../trpc";

class BadgeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeLimitError";
  }
}

const prismaMock = {
  user: {
    count: mock((): Promise<number> => Promise.resolve(0)),
    findMany: mock((): Promise<{ id: string }[]> => Promise.resolve([])),
    findUnique: mock((): Promise<{ role: string } | null> =>
      Promise.resolve(null)
    ),
    update: mock((): Promise<{ id: string }> => Promise.resolve({ id: "u" })),
    updateMany: mock((): Promise<{ count: number }> =>
      Promise.resolve({ count: 1 })
    ),
  },
};

const userCacheMock = {
  checkRateLimit: mock((): Promise<{ allowed: boolean; resetTime: number }> =>
    Promise.resolve({ allowed: true, resetTime: 0 })
  ),
  invalidateSearchCache: mock((): Promise<void> => Promise.resolve()),
  invalidateUserDetail: mock((): Promise<void> => Promise.resolve()),
  invalidateUserList: mock((): Promise<void> => Promise.resolve()),
  invalidateUserStats: mock((): Promise<void> => Promise.resolve()),
};

const grantBadgeMock = mock((): Promise<boolean> => Promise.resolve(true));
const revokeBadgeMock = mock((): Promise<boolean> => Promise.resolve(true));

mock.module("@asm/auth/core", () => ({
  getSessionFromRequest: mock(() => ({ session: null, user: null })),
}));

mock.module("@asm/db", () => ({
  BADGES: ["author", "dev", "early", "shitposter"],
  BadgeLimitError,
  grantBadge: grantBadgeMock,
  prisma: prismaMock,
  revokeBadge: revokeBadgeMock,
  userCache: userCacheMock,
}));

const adminContext = {
  req: new Request("https://auth.localhost/api/trpc"),
  resHeaders: new Headers(),
  session: { id: "s1", userId: "admin1" },
  user: { id: "admin1", role: "admin" },
} as unknown as Context;

async function caller() {
  const { adminRouter } = await import("./index");
  return adminRouter.createCaller(adminContext);
}

beforeEach(() => {
  prismaMock.user.count.mockClear();
  prismaMock.user.findMany.mockClear();
  prismaMock.user.findUnique.mockClear();
  prismaMock.user.update.mockClear();
  prismaMock.user.updateMany.mockClear();
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.update.mockResolvedValue({ id: "u" });
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
  userCacheMock.checkRateLimit.mockClear();
  userCacheMock.checkRateLimit.mockResolvedValue({
    allowed: true,
    resetTime: 0,
  });
  grantBadgeMock.mockClear();
  grantBadgeMock.mockImplementation(() => Promise.resolve(true));
  revokeBadgeMock.mockClear();
  revokeBadgeMock.mockImplementation(() => Promise.resolve(true));
});

describe("admin setRole hard rules", () => {
  test("rejects promoting a second admin", async () => {
    prismaMock.user.count.mockResolvedValue(1);

    const trpc = await caller();
    const promise = trpc.setRole({ role: "admin", userId: "u2" });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("rejects demoting the last admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "admin" });

    const trpc = await caller();
    const promise = trpc.setRole({ role: "user", userId: "admin1" });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("allows promoting when no admin exists yet", async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const trpc = await caller();
    await trpc.setRole({ role: "admin", userId: "u2" });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      data: { role: "admin" },
      where: { id: "u2" },
    });
  });
});

describe("admin bulkUpdateUsers / updateUser role guards", () => {
  test("bulkUpdateUsers rejects promoting a second admin", async () => {
    prismaMock.user.count.mockResolvedValue(1);

    const trpc = await caller();
    const promise = trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "admin" },
      userIds: ["u2"],
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  test("bulkUpdateUsers rejects promoting more than one user at once", async () => {
    const trpc = await caller();
    const promise = trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "admin" },
      userIds: ["u2", "u3"],
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  test("bulkUpdateUsers rejects demoting every current admin", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }]);

    const trpc = await caller();
    const promise = trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "user" },
      userIds: ["admin1"],
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  test("bulkUpdateUsers allows demoting a non-admin or when other admins remain", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "admin1" },
      { id: "admin2" },
    ]);

    const trpc = await caller();
    await trpc.bulkUpdateUsers({
      action: "updateRole",
      data: { role: "user" },
      userIds: ["admin1"],
    });

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      data: { role: "user" },
      where: { id: { in: ["admin1"] } },
    });
  });

  test("updateUser rejects demoting the last admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "admin" });
    prismaMock.user.count.mockResolvedValue(0);

    const trpc = await caller();
    const promise = trpc.updateUser({
      data: { role: "user" },
      userId: "admin1",
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("admin setBadge hard rules", () => {
  test("surfaces the single-author rule as a CONFLICT error", async () => {
    grantBadgeMock.mockImplementation(() => {
      throw new BadgeLimitError("Only one author is allowed for the app.");
    });

    const trpc = await caller();
    const promise = trpc.setBadge({
      badge: "author",
      grant: true,
      userId: "u2",
    });

    await expect(promise).rejects.toMatchObject({ code: "CONFLICT" });
    expect(grantBadgeMock).toHaveBeenCalledWith("u2", "author");
  });

  test("grants a badge and invalidates caches", async () => {
    const trpc = await caller();
    const result = await trpc.setBadge({
      badge: "dev",
      grant: true,
      userId: "u2",
    });

    expect(result).toEqual({ changed: true, success: true });
    expect(userCacheMock.invalidateUserDetail).toHaveBeenCalledWith("u2");
  });

  test("revokes a badge", async () => {
    const trpc = await caller();
    await trpc.setBadge({ badge: "early", grant: false, userId: "u2" });

    expect(revokeBadgeMock).toHaveBeenCalledWith("u2", "early");
  });
});

import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const USER_ID = "auth-user-1";

let mockSessionUser: { user: { id: string } } | null = null;
const mockGetSession = mock(() => mockSessionUser);

let redisStore = new Map<string, string>();
const mockRedis = {
  get: mock((key: string) => redisStore.get(key) ?? null),
  setex: mock((key: string, _ttl: number, value: string) => {
    redisStore.set(key, value);
    return "OK";
  }),
};

const users = [
  { aura: 500, displayName: "Top User", id: "u1", username: "top" },
  { aura: 400, displayName: "Auth User", id: USER_ID, username: "auth" },
  { aura: 300, displayName: "Third User", id: "u3", username: "third" },
  { aura: 999, displayName: "Zeph", id: "sys-zeph", username: "zeph" },
];

const mockPrisma = {
  user: {
    findMany: (args: {
      orderBy: unknown;
      select: unknown;
      take: number;
      where: { AND: { id: { not: string | undefined } }[] };
    }) => {
      const excludeIds = args.where.AND.map((clause) => clause.id?.not).filter(
        (id): id is string => Boolean(id)
      );
      const filtered = excludeIds.length
        ? users.filter((u) => !excludeIds.includes(u.id))
        : users;
      return filtered.slice(0, args.take);
    },
  },
};

mock.module("@asm/db", () => ({
  SYSTEM_MODERATION_USER_ID: "sys-zeph",
  getUserDataSelect: (loggedInUserId: string) => ({
    aura: true,
    displayName: true,
    id: true,
    isFollowedByLoggedUser: Boolean(loggedInUserId),
    username: true,
  }),
  prisma: mockPrisma,
  redis: mockRedis,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/users/trending cache separation", () => {
  beforeEach(() => {
    mockSessionUser = null;
    redisStore = new Map();
    mockRedis.get.mockClear();
    mockRedis.setex.mockClear();
    mockGetSession.mockClear();
  });

  test("guest request sets cache-control public and vary Cookie, and caches in Redis", async () => {
    mockSessionUser = null;

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("vary")).toBe("Cookie");

    const data = await res.json();
    expect(data).toHaveLength(3);
    expect(
      data.find((u: { id: string }) => u.id === "sys-zeph")
    ).toBeUndefined();
    expect(mockRedis.setex).toHaveBeenCalledTimes(1);
  });

  test("warmed guest cache does not leak to authenticated user request", async () => {
    // 1. Warm the guest cache in Redis
    mockSessionUser = null;
    const guestRes = await GET();
    expect(guestRes.status).toBe(200);
    expect(redisStore.has("trending:users:global:v2")).toBe(true);

    // 2. Make authenticated request - must NOT return the cached guest response
    mockSessionUser = { user: { id: USER_ID } };
    const authRes = await GET();

    expect(authRes.status).toBe(200);
    expect(authRes.headers.get("cache-control")).toBe("private, no-cache");
    expect(authRes.headers.get("vary")).toBe("Cookie");

    const authData = await authRes.json();
    // Authenticated query filters out the logged-in user (USER_ID)
    expect(
      authData.find((u: { id: string }) => u.id === USER_ID)
    ).toBeUndefined();
    // The system moderation persona is never surfaced.
    expect(
      authData.find((u: { id: string }) => u.id === "sys-zeph")
    ).toBeUndefined();
    expect(authData).toHaveLength(2);
  });
});

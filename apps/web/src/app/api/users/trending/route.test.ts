import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

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
  {
    aura: 500,
    createdAt: new Date(0),
    displayName: "Top User",
    follows: { total: 0 },
    followsFollows: [],
    id: "u1",
    username: "top",
  },
  {
    aura: 400,
    createdAt: new Date(0),
    displayName: "Auth User",
    follows: { total: 0 },
    followsFollows: [],
    id: USER_ID,
    username: "auth",
  },
  {
    aura: 300,
    createdAt: new Date(0),
    displayName: "Third User",
    follows: { total: 0 },
    followsFollows: [],
    id: "u3",
    username: "third",
  },
  {
    aura: 999,
    createdAt: new Date(0),
    displayName: "Zeph",
    follows: { total: 0 },
    followsFollows: [],
    id: "sys-zeph",
    username: "zeph",
  },
];

interface UserQuery {
  all: () => typeof users;
  include: () => UserQuery;
  where: (
    predicate: (user: { id: { neq: (id: string) => unknown } }) => unknown
  ) => { all: () => typeof users };
}

let excludedIds: string[] = [];
function createUserQuery(): UserQuery {
  return {
    all: () => users,
    include: () => createUserQuery(),
    where: (predicate) => {
      const ids: string[] = [];
      predicate({
        id: {
          neq: (id) => {
            ids.push(id);
            return {};
          },
        },
      });
      excludedIds = ids;
      return {
        all: () => users.filter((user) => !excludedIds.includes(user.id)),
      };
    },
  };
}

const mockPrisma = {
  orm: { public: {} },
};

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  SYSTEM_MODERATION_USER_ID: "sys-zeph",
  awardTrendingCardPresence: () => Promise.resolve(),
  getUserDataQuery: () => createUserQuery(),
  mapUserData: (user: (typeof users)[number]) => user,
  prisma: mockPrisma,
  redis: mockRedis,
}));

mock.module("@/lib/auth/session", () => ({
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

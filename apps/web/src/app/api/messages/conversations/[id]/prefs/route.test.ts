import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  DEN_DETAILS_RATE_LIMIT,
  DEN_PREFS_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { PATCH } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockReset = mock(() => Promise.resolve());
let conversationType = "DM";
let updateValue: Record<string, unknown> = {};
let selectColumns: string[] = [];

const MUTED_AT = new Date("2026-01-01T00:00:00.000Z");

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === "convo-1" && userId === "user1"
      ? {
          id: "convo-1",
          members: [
            {
              lastReadAt: null,
              mutedAt: null,
              role: "MEMBER",
              userId: "user1",
            },
          ],
          type: conversationType,
        }
      : null,
  parseJsonBody: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  fromPrismaDateTime: (value: Date) => value,
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          // The route goes .where(...).select(...).update(...).
          where: () => ({
            select: (...columns: string[]) => {
              selectColumns = columns;
              return {
                update: (value: Record<string, unknown>) => {
                  updateValue = value;
                  return {
                    mutedAt: value.mutedAt ?? null,
                    themeKey: (value.themeKey as string | null) ?? null,
                  };
                },
              };
            },
          }),
        },
      },
    },
  },
  toPrismaDateTime: (value: Date) => value,
  unreadMessageCache: { reset: mockReset },
}));

function prefsRequest(body: unknown) {
  return new Request(
    "http://localhost:3000/api/messages/conversations/convo-1/prefs",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    }
  );
}

const params = { params: Promise.resolve({ id: "convo-1" }) };

describe("PATCH /api/messages/conversations/:id/prefs", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockReset.mockReset();
    mockReset.mockImplementation(() => Promise.resolve());
    conversationType = "DM";
    updateValue = {};
    selectColumns = [];
    limiter.reset();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await PATCH(prefsRequest({ muted: true }), params);
    expect(res.status).toBe(401);
  });

  test("404s for a non-member", async () => {
    mockGetSession.mockReturnValueOnce({ user: { id: "intruder" } });
    const res = await PATCH(prefsRequest({ muted: true }), params);
    expect(res.status).toBe(404);
  });

  test("mutes and stores a real timestamp", async () => {
    const res = await PATCH(prefsRequest({ muted: true }), params);
    expect(res.status).toBe(200);
    // The update only ever sets mutedAt, never the other preferences, so one
    // cannot clobber another when the panel sends them separately.
    expect(selectColumns).toEqual([
      "mutedAt",
      "themeKey",
      "wallpaperDim",
      "wallpaperKey",
      "wallpaperMediaId",
    ]);
    expect(Object.keys(updateValue)).toEqual(["mutedAt"]);
    expect(updateValue.mutedAt).toBeInstanceOf(Date);
  });

  test("unmutes by clearing the timestamp", async () => {
    const res = await PATCH(prefsRequest({ muted: false }), params);
    expect(res.status).toBe(200);
    expect(updateValue.mutedAt).toBeNull();
  });

  test("resets the cached badge when the mute changes, in both directions", async () => {
    // The counter has no TTL and the unread seed excludes muted memberships, so
    // a cached value computed under the old mute is wrong the moment the
    // preference changes. Resetting forces the next read to reseed.
    await PATCH(prefsRequest({ muted: true }), params);
    expect(mockReset).toHaveBeenCalledWith("user1");

    mockReset.mockClear();
    await PATCH(prefsRequest({ muted: false }), params);
    expect(mockReset).toHaveBeenCalledWith("user1");
  });

  test("leaves the badge alone when only the theme changes", async () => {
    // A theme cannot alter the unread count, so reseeding would be pure churn.
    const res = await PATCH(prefsRequest({ themeKey: "ocean" }), params);
    expect(res.status).toBe(200);
    expect(updateValue.themeKey).toBe("ocean");
    expect(mockReset).not.toHaveBeenCalled();
  });

  test("keeps the original mute timestamp when re-muting", async () => {
    // mutedAt is when the mute began, not when it was last toggled, so churning
    // it on every press would throw that history away.
    mock.module("@/lib/messages/server", () => ({
      getConversationForUser: () => ({
        id: "convo-1",
        members: [{ lastReadAt: null, mutedAt: MUTED_AT, userId: "user1" }],
      }),
      parseJsonBody: (request: Request) => request.json(),
    }));
    const res = await PATCH(prefsRequest({ muted: true }), params);
    expect(res.status).toBe(200);
    expect(updateValue.mutedAt).toBe(MUTED_AT);
  });

  test("rejects an unknown theme key rather than storing it", async () => {
    const res = await PATCH(
      prefsRequest({ themeKey: "not-a-real-theme" }),
      params
    );
    expect(res.status).toBe(400);
  });

  test("requires at least one preference", async () => {
    const res = await PATCH(prefsRequest({}), params);
    expect(res.status).toBe(400);
  });

  test("rejects a non-boolean mute", async () => {
    const res = await PATCH(prefsRequest({ muted: "yes" }), params);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/messages/conversations/:id/prefs rate limit", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockReset.mockReset();
    mockReset.mockImplementation(() => Promise.resolve());
    updateValue = {};
    selectColumns = [];
    limiter.reset();
  });

  test("spends the prefs budget, per account", async () => {
    const res = await PATCH(prefsRequest({ muted: true }), params);
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([DEN_PREFS_RATE_LIMIT.bucket]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("429s with a retry-after and writes nothing when over budget", async () => {
    limiter.setDenied(true);
    const res = await PATCH(prefsRequest({ muted: true }), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(updateValue).toEqual({});
    expect(mockReset).not.toHaveBeenCalled();
  });

  test("is looser than the den-details budget it reasons alongside", () => {
    // Prefs are four columns on the caller's own row and nothing is broadcast,
    // so it cannot cost more than a den rename. Pinned because the two budgets
    // are the same class of thing - single-row writes a UI can loop - and a
    // future edit that tightens prefs below den details would be tightening the
    // cheaper write, which is backwards.
    expect(DEN_PREFS_RATE_LIMIT.limit).toBeGreaterThanOrEqual(
      DEN_DETAILS_RATE_LIMIT.limit
    );
  });
});

test("ordinary den members cannot change the shared wallpaper or dim", async () => {
  conversationType = "DEN";
  mock.module("@/lib/messages/server", () => ({
    getConversationForUser: () => ({
      id: "convo-1",
      members: [{ role: "MEMBER", userId: "user1" }],
      type: "DEN",
    }),
  }));
  const response = await PATCH(prefsRequest({ wallpaperDim: 50 }), params);
  expect(response.status).toBe(403);
  expect(updateValue).toEqual({});
});

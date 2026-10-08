import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  DEN_PREFS_RATE_LIMIT,
  DEN_WALLPAPER_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { DELETE, POST } from "./route";

// The wallpaper link route. Both methods claim or clear a single column on the
// caller's own membership row, which is cheap; what is not cheap is what happens
// when a wallpaper is REPLACED, because the displaced upload is handed to the
// cleanup worker. That is the reason this route is metered at all, and it is why
// both methods charge the same bucket: both can schedule one.

let conversationType = "DM";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));

// The upload the caller is trying to link. `owned` decides whether the row is
// theirs at all, which is the first thing the route checks.
let media: {
  detectedMime: string;
  height: number;
  id: string;
  mimeType: string;
  size: number;
  status: string;
  _type: string;
  userId: string;
  width: number;
} | null = null;
const mockMediaFirst = mock(() => Promise.resolve(media));

// The member row the link lands on. `wallpaperMediaId` is what a replacement
// displaces, and what the clear path reports.
let memberRow: {
  mutedAt: null;
  themeKey: null;
  wallpaperDim: null;
  wallpaperKey: null;
  wallpaperMediaId: string | null;
} = {
  mutedAt: null,
  themeKey: null,
  wallpaperDim: null,
  wallpaperKey: null,
  wallpaperMediaId: null,
};
let _memberSelectWhere: { conversationId: string; userId: string } | null =
  null;
const mockMemberUpdate = mock(
  (value: { wallpaperMediaId?: string | null; wallpaperKey?: null }) => {
    const next = { ...memberRow, ...value };
    memberRow = next;
    return next;
  }
);

const mockCancelCleanup = mock(() => Promise.resolve());
const mockScheduleCleanup = mock(() => {
  limiter.service("schedule-cleanup");
  return Promise.resolve();
});

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    Promise.resolve(
      conversationId === "convo-1" && userId === "user1"
        ? {
            id: "convo-1",
            members: [{ role: "MEMBER", userId }],
            type: conversationType,
          }
        : null
    ),
  parseJsonBody: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
}));

mock.module("@asm/db", () => ({
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  cancelMediaCleanup: mockCancelCleanup,
  fromPrismaDateTime: (value: Date) => value,
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          select: () => ({
            where: () => ({ first: () => Promise.resolve(memberRow) }),
          }),
          where: (
            predicate: (member: {
              conversationId: { eq: (id: string) => unknown };
              userId: { eq: (id: string) => unknown };
            }) => unknown
          ) => {
            const captured: { conversationId: string; userId: string } = {
              conversationId: "",
              userId: "",
            };
            predicate({
              conversationId: {
                eq: (id) => {
                  captured.conversationId = id;
                  return {};
                },
              },
              userId: {
                eq: (id) => {
                  captured.userId = id;
                  return {};
                },
              },
            });
            _memberSelectWhere = captured;
            const builder = {
              first: () => Promise.resolve(memberRow),
              select: () => ({ update: mockMemberUpdate }),
              update: mockMemberUpdate,
            };
            return builder;
          },
        },
        PostMedia: {
          select: () => ({ where: () => ({ first: mockMediaFirst }) }),
        },
      },
    },
  },
  scheduleMediaCleanup: mockScheduleCleanup,
}));

const PARAMS = { params: Promise.resolve({ id: "convo-1" }) };

function link(mediaId: string) {
  return POST(
    new Request("http://localhost/wallpaper", {
      body: JSON.stringify({ mediaId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    PARAMS
  );
}

function clear() {
  return DELETE(
    new Request("http://localhost/wallpaper", { method: "DELETE" }),
    PARAMS
  );
}

function ownedImage(id: string) {
  return {
    _type: "IMAGE",
    detectedMime: "image/png",
    height: 1080,
    id,
    mimeType: "image/png",
    size: 400_000,
    status: "READY",
    userId: "user1",
    width: 1920,
  };
}

beforeEach(() => {
  conversationType = "DM";
  mockGetSession.mockReset();
  mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
  media = ownedImage("media-2");
  memberRow = {
    mutedAt: null,
    themeKey: null,
    wallpaperDim: null,
    wallpaperKey: null,
    wallpaperMediaId: "media-1",
  };
  _memberSelectWhere = null;
  mockMediaFirst.mockReset();
  mockMediaFirst.mockImplementation(() => Promise.resolve(media));
  mockMemberUpdate.mockClear();
  mockCancelCleanup.mockReset();
  mockCancelCleanup.mockImplementation(() => Promise.resolve());
  mockScheduleCleanup.mockReset();
  mockScheduleCleanup.mockImplementation(() => {
    limiter.service("schedule-cleanup");
    return Promise.resolve();
  });
  limiter.reset();
});

describe("POST /api/messages/conversations/:id/wallpaper", () => {
  test("claims the caller's own ready image and schedules the one it replaced", async () => {
    const res = await link("media-2");
    expect(res.status).toBe(200);
    expect(memberRow.wallpaperMediaId).toBe("media-2");
    expect(mockCancelCleanup).toHaveBeenCalledWith("media-2");
    expect(mockScheduleCleanup).toHaveBeenCalledWith("media-1");
  });

  test("404s a row the caller does not own", async () => {
    media = { ...ownedImage("media-2"), userId: "someone-else" };
    const res = await link("media-2");
    expect(res.status).toBe(404);
    expect(mockMemberUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/messages/conversations/:id/wallpaper", () => {
  test("clears the link and schedules the upload it dropped", async () => {
    const res = await clear();
    expect(res.status).toBe(200);
    expect(memberRow.wallpaperMediaId).toBeNull();
    expect(mockScheduleCleanup).toHaveBeenCalledWith("media-1");
  });
});

describe("/api/messages/conversations/:id/wallpaper rate limit", () => {
  test("a link spends the wallpaper budget, per account", async () => {
    const res = await link("media-2");
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([DEN_WALLPAPER_RATE_LIMIT.bucket]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("a clear spends the same budget", async () => {
    // Both methods schedule a cleanup job for the row they displaced, so both are
    // bounded by the same thing. Separate budgets would let a clear loop refill
    // what a link loop spends, and neither has any use the other does not.
    const res = await clear();
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([DEN_WALLPAPER_RATE_LIMIT.bucket]);
  });

  test("429s with a retry-after and enqueues no cleanup when over budget", async () => {
    // The queue is the reason. A link that displaces a wallpaper hands it to the
    // cleanup worker, so an unbounded loop here is a job-queue fill primitive and
    // not merely an update loop.
    limiter.setDenied(true);
    const res = await link("media-2");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockMediaFirst).not.toHaveBeenCalled();
    expect(mockMemberUpdate).not.toHaveBeenCalled();
    expect(mockScheduleCleanup).not.toHaveBeenCalled();
  });

  test("429s a clear before it reads or writes the row", async () => {
    limiter.setDenied(true);
    const res = await clear();
    expect(res.status).toBe(429);
    expect(mockMemberUpdate).not.toHaveBeenCalled();
    expect(mockScheduleCleanup).not.toHaveBeenCalled();
  });

  test("charges the limiter before the media lookup", async () => {
    await link("media-2");
    expect(limiter.order[0]).toBe(`consume:${DEN_WALLPAPER_RATE_LIMIT.bucket}`);
    expect(limiter.order).toContain("service:schedule-cleanup");
  });

  test("two accounts do not share one budget", async () => {
    await link("media-2");
    mockGetSession.mockImplementation(() => ({ user: { id: "user2" } }));
    await link("media-2");
    expect(limiter.chargedIdentifiers).toEqual(["user1", "user2"]);
  });

  test("is looser than prefs, because it schedules a job rather than writing a column", () => {
    // Pinned so a future tightening on either side has to say out loud that the
    // ordering flipped: prefs is four writes on the caller's own row, wallpaper
    // is one write plus a queue hand-off.
    expect(DEN_WALLPAPER_RATE_LIMIT.limit).toBeLessThan(
      DEN_PREFS_RATE_LIMIT.limit
    );
  });
});

test("ordinary den members cannot upload or remove the shared wallpaper", async () => {
  conversationType = "DEN";
  const uploadResponse = await link("media-2");
  const removeResponse = await clear();
  expect(uploadResponse.status).toBe(403);
  expect(removeResponse.status).toBe(403);
  expect(mockMemberUpdate).not.toHaveBeenCalled();
  expect(mockScheduleCleanup).not.toHaveBeenCalled();
});

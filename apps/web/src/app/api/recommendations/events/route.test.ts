import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

const createEvent = mock(() => Promise.resolve({}));
const mockGetSession = mock(() =>
  Promise.resolve<{ user: { id: string } } | null>({ user: { id: "user-1" } })
);
// Posts the route treats as still existing. A test can drop an id to simulate a
// post deleted while a viewer still had it on screen.
let existingPosts = [{ id: "post-1" }];
const findPosts = mock(() => Promise.resolve(existingPosts));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  consumeRateLimit: mock(() =>
    Promise.resolve({ allowed: true, remaining: 119, retryAfterSeconds: 0 })
  ),
  invalidateFypProfile: mock(() => Promise.resolve()),
  prisma: {
    orm: {
      public: {
        Posts: {
          select: () => ({
            where: (
              predicate: (post: {
                id: { in: (ids: string[]) => unknown };
              }) => unknown
            ) => {
              predicate({ id: { in: () => {} } });
              return { all: findPosts };
            },
          }),
        },
        RecommendationEvents: { create: createEvent },
      },
    },
  },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

function request(body: unknown): Request {
  return new Request("http://localhost/api/recommendations/events", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/recommendations/events", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    createEvent.mockClear();
    findPosts.mockClear();
    existingPosts = [{ id: "post-1" }];
  });

  test("requires an authenticated viewer", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const response = await POST(request({ events: [] }));

    expect(response.status).toBe(401);
    expect(createEvent).not.toHaveBeenCalled();
  });

  test("rejects malformed or unsupported events", async () => {
    const response = await POST(
      request({ events: [{ eventType: "UNKNOWN", postId: "post-1" }] })
    );

    expect(response.status).toBe(400);
    expect(createEvent).not.toHaveBeenCalled();
  });

  test("stores bounded behavioral events for known posts", async () => {
    const response = await POST(
      request({
        events: [
          { eventType: "IMPRESSION", postId: "post-1" },
          { durationMs: 999_999_999, eventType: "DWELL", postId: "post-1" },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenNthCalledWith(1, {
      dedupeKey: `impression:user-1:post-1:${new Date().toISOString().slice(0, 10)}`,
      durationMs: null,
      eventType: "IMPRESSION",
      postId: "post-1",
      sessionId: null,
      userId: "user-1",
      value: null,
    });
    expect(createEvent).toHaveBeenNthCalledWith(2, {
      dedupeKey: null,
      durationMs: 1_800_000,
      eventType: "DWELL",
      postId: "post-1",
      sessionId: null,
      userId: "user-1",
      value: null,
    });
  });

  test("drops events for a deleted post but still records the rest", async () => {
    // Only post-2 exists now; the post-1 event is stale telemetry.
    existingPosts = [{ id: "post-2" }];

    const response = await POST(
      request({
        events: [
          { eventType: "VIEW_START", postId: "post-1" },
          { eventType: "VIEW_START", postId: "post-2" },
        ],
      })
    );

    // A partial drop must still succeed: rejecting the batch would make the
    // client re-queue it forever and stall every later event behind it.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 1 });
    expect(createEvent).toHaveBeenCalledWith({
      dedupeKey: null,
      durationMs: null,
      eventType: "VIEW_START",
      postId: "post-2",
      sessionId: null,
      userId: "user-1",
      value: null,
    });
  });

  test("retries once when a post is deleted between the check and the insert", async () => {
    // Both posts pass the existence check, then post-1 is deleted before the
    // batch insert, which trips the foreign key.
    existingPosts = [{ id: "post-1" }, { id: "post-2" }];
    findPosts
      .mockResolvedValueOnce([{ id: "post-1" }, { id: "post-2" }])
      .mockResolvedValueOnce([{ id: "post-2" }]);
    createEvent.mockRejectedValueOnce({ code: "P2003" });

    const response = await POST(
      request({
        events: [
          { eventType: "VIEW_START", postId: "post-1" },
          { eventType: "VIEW_START", postId: "post-2" },
        ],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 1 });
    expect(createEvent).toHaveBeenCalledTimes(3);
    expect(createEvent).toHaveBeenLastCalledWith({
      dedupeKey: null,
      durationMs: null,
      eventType: "VIEW_START",
      postId: "post-2",
      sessionId: null,
      userId: "user-1",
      value: null,
    });
  });

  test("accepts (and drops) an all-stale batch without a 404", async () => {
    existingPosts = [];

    const response = await POST(
      request({ events: [{ eventType: "VIEW_START", postId: "gone" }] })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 0 });
    expect(createEvent).not.toHaveBeenCalled();
  });
});

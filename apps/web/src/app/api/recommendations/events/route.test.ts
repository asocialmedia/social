import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const createMany = mock(() => Promise.resolve({ count: 0 }));
const mockGetSession = mock(() =>
  Promise.resolve<{ user: { id: string } } | null>({ user: { id: "user-1" } })
);
// Posts the route treats as still existing. A test can drop an id to simulate a
// post deleted while a viewer still had it on screen.
let existingPosts = [{ id: "post-1" }];
const findPosts = mock(() => Promise.resolve(existingPosts));

mock.module("@asm/db", () => ({
  consumeRateLimit: mock(() =>
    Promise.resolve({ allowed: true, remaining: 119, retryAfterSeconds: 0 })
  ),
  invalidateFypProfile: mock(() => Promise.resolve()),
  prisma: {
    post: { findMany: findPosts },
    recommendationEvent: { createMany },
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
    createMany.mockClear();
    findPosts.mockClear();
    existingPosts = [{ id: "post-1" }];
  });

  test("requires an authenticated viewer", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const response = await POST(request({ events: [] }));

    expect(response.status).toBe(401);
    expect(createMany).not.toHaveBeenCalled();
  });

  test("rejects malformed or unsupported events", async () => {
    const response = await POST(
      request({ events: [{ eventType: "UNKNOWN", postId: "post-1" }] })
    );

    expect(response.status).toBe(400);
    expect(createMany).not.toHaveBeenCalled();
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
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          dedupeKey: `impression:user-1:post-1:${new Date().toISOString().slice(0, 10)}`,
          durationMs: undefined,
          eventType: "IMPRESSION",
          postId: "post-1",
          sessionId: undefined,
          userId: "user-1",
          value: undefined,
        },
        {
          dedupeKey: undefined,
          durationMs: 1_800_000,
          eventType: "DWELL",
          postId: "post-1",
          sessionId: undefined,
          userId: "user-1",
          value: undefined,
        },
      ],
      skipDuplicates: true,
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
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          dedupeKey: undefined,
          durationMs: undefined,
          eventType: "VIEW_START",
          postId: "post-2",
          sessionId: undefined,
          userId: "user-1",
          value: undefined,
        },
      ],
      skipDuplicates: true,
    });
  });

  test("retries once when a post is deleted between the check and the insert", async () => {
    // Both posts pass the existence check, then post-1 is deleted before the
    // batch insert, which trips the foreign key.
    existingPosts = [{ id: "post-1" }, { id: "post-2" }];
    findPosts
      .mockResolvedValueOnce([{ id: "post-1" }, { id: "post-2" }])
      .mockResolvedValueOnce([{ id: "post-2" }]);
    createMany.mockRejectedValueOnce({ code: "P2003" });

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
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenLastCalledWith({
      data: [
        {
          dedupeKey: undefined,
          durationMs: undefined,
          eventType: "VIEW_START",
          postId: "post-2",
          sessionId: undefined,
          userId: "user-1",
          value: undefined,
        },
      ],
      skipDuplicates: true,
    });
  });

  test("accepts (and drops) an all-stale batch without a 404", async () => {
    existingPosts = [];

    const response = await POST(
      request({ events: [{ eventType: "VIEW_START", postId: "gone" }] })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 0 });
    expect(createMany).not.toHaveBeenCalled();
  });
});

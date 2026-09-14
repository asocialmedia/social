import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const createMany = mock(() => Promise.resolve({ count: 0 }));
const mockGetSession = mock(() =>
  Promise.resolve<{ user: { id: string } } | null>({ user: { id: "user-1" } })
);

mock.module("@asm/db", () => ({
  consumeRateLimit: mock(() =>
    Promise.resolve({ allowed: true, remaining: 119, retryAfterSeconds: 0 })
  ),
  invalidateFypProfile: mock(() => Promise.resolve()),
  prisma: {
    post: {
      findMany: mock(() => Promise.resolve([{ id: "post-1" }])),
    },
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
});

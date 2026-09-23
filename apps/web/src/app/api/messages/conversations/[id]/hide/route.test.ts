import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockFindMany = mock((_args: unknown): unknown[] => []);
const mockCreateMany = mock((_args: unknown) => ({ count: 0 }));
const mockDecrement = mock((_userId: string, _count: number) => 0);

const READ_AT = new Date("2026-01-01T00:00:00.000Z");

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === "convo-1" && userId === "user1"
      ? {
          id: "convo-1",
          members: [
            { lastReadAt: READ_AT, userId: "user1" },
            { lastReadAt: null, userId: "user2" },
          ],
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
  prisma: {
    message: { findMany: mockFindMany },
    messageHidden: { createMany: mockCreateMany },
  },
  unreadMessageCache: { decrement: mockDecrement },
}));

function hideRequest(body: unknown) {
  return new Request(
    "http://localhost:3000/api/messages/conversations/convo-1/hide",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
}

const params = { params: Promise.resolve({ id: "convo-1" }) };

describe("POST /api/messages/conversations/:id/hide", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockFindMany.mockReset();
    mockFindMany.mockImplementation(() => []);
    mockCreateMany.mockReset();
    mockCreateMany.mockImplementation(() => ({ count: 0 }));
    mockDecrement.mockReset();
    mockDecrement.mockImplementation(() => 0);
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(401);
  });

  test("404s for a non-member", async () => {
    mockGetSession.mockReturnValueOnce({ user: { id: "intruder" } });
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(404);
  });

  test("rejects an empty or non-array body", async () => {
    const empty = await POST(hideRequest({ messageIds: [] }), params);
    expect(empty.status).toBe(400);
    const notArray = await POST(hideRequest({ messageIds: "m1" }), params);
    expect(notArray.status).toBe(400);
    const missing = await POST(hideRequest({}), params);
    expect(missing.status).toBe(400);
  });

  test("rejects more than the batch cap", async () => {
    const res = await POST(
      hideRequest({
        messageIds: Array.from({ length: 101 }, (_, i) => `m${i}`),
      }),
      params
    );
    expect(res.status).toBe(400);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  test("hides only rows that belong to the conversation", async () => {
    mockFindMany.mockReturnValueOnce([
      {
        createdAt: new Date("2025-12-31T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user1",
      },
    ]);
    const res = await POST(
      hideRequest({ messageIds: ["m1", "foreign-id", "m1"] }),
      params
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: 1 });
    // The query is scoped to the conversation and receives the deduped ids.
    const args = mockFindMany.mock.calls[0]?.[0] as {
      where: { conversationId: string; id: { in: string[] } };
    };
    expect(args.where.conversationId).toBe("convo-1");
    expect(args.where.id.in.toSorted()).toEqual(["foreign-id", "m1"]);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
  });

  test("credits the badge for newly hidden unread peer messages", async () => {
    mockFindMany.mockReturnValueOnce([
      // Unread peer message, newer than the read watermark.
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
      // Own message: never counted.
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m2",
        senderId: "user1",
      },
      // Already read.
      {
        createdAt: new Date("2025-12-31T00:00:00.000Z"),
        deletedAt: null,
        id: "m3",
        senderId: "user2",
      },
      // Globally deleted: not counted.
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: new Date(),
        id: "m4",
        senderId: "user2",
      },
    ]);
    const res = await POST(
      hideRequest({ messageIds: ["m1", "m2", "m3", "m4"] }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockDecrement).toHaveBeenCalledWith("user1", 1);
  });

  test("keeps the hide successful when the badge credit fails", async () => {
    mockFindMany.mockReturnValueOnce([
      {
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        deletedAt: null,
        id: "m1",
        senderId: "user2",
      },
    ]);
    mockDecrement.mockImplementationOnce(() => {
      throw new Error("redis down");
    });
    const res = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(res.status).toBe(200);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
  });

  test("returns zero without writing when nothing matches", async () => {
    mockFindMany.mockReturnValueOnce([]);
    const res = await POST(hideRequest({ messageIds: ["ghost"] }), params);
    expect(await res.json()).toEqual({ hidden: 0 });
    expect(mockCreateMany).not.toHaveBeenCalled();
  });
});

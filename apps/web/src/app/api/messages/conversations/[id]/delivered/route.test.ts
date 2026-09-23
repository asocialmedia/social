import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockFindFirst = mock((_args: unknown): unknown => null);
const mockUpdateMany = mock((_args: unknown) => ({ count: 1 }));
const mockPublishDelivered = mock(
  (_conversationId: string, _userId: string, _deliveredAt: string) =>
    Promise.resolve()
);

const CREATED_AT = new Date("2026-01-01T12:00:00.000Z");

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === "convo-1" && userId === "user1"
      ? { id: "convo-1" }
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
    message: { findFirst: mockFindFirst },
    messageConversationMember: { updateMany: mockUpdateMany },
  },
  publishConversationDelivered: mockPublishDelivered,
}));

function deliveredRequest(body: unknown) {
  return new Request(
    "http://localhost:3000/api/messages/conversations/convo-1/delivered",
    {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
}

const params = { params: Promise.resolve({ id: "convo-1" }) };

describe("POST /api/messages/conversations/:id/delivered", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockFindFirst.mockReset();
    mockFindFirst.mockImplementation(() => ({
      createdAt: CREATED_AT,
      senderId: "user2",
    }));
    mockUpdateMany.mockReset();
    mockUpdateMany.mockImplementation(() => ({ count: 1 }));
    mockPublishDelivered.mockReset();
    mockPublishDelivered.mockImplementation(() => Promise.resolve());
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(401);
  });

  test("404s for a non-member", async () => {
    mockGetSession.mockReturnValueOnce({ user: { id: "intruder" } });
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(404);
  });

  test("rejects a missing messageId", async () => {
    const res = await POST(deliveredRequest({}), params);
    expect(res.status).toBe(400);
  });

  test("404s an unknown message", async () => {
    mockFindFirst.mockReturnValueOnce(null);
    const res = await POST(deliveredRequest({ messageId: "ghost" }), params);
    expect(res.status).toBe(404);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("does not move the watermark for the acker's own message", async () => {
    mockFindFirst.mockReturnValueOnce({
      createdAt: CREATED_AT,
      senderId: "user1",
    });
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(200);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockPublishDelivered).not.toHaveBeenCalled();
  });

  test("advances the watermark monotonically and publishes", async () => {
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(200);
    const args = mockUpdateMany.mock.calls[0]?.[0] as {
      data: { lastDeliveredAt: Date };
      where: {
        conversationId: string;
        OR: unknown[];
        userId: string;
      };
    };
    expect(args.where.conversationId).toBe("convo-1");
    expect(args.where.userId).toBe("user1");
    expect(args.data.lastDeliveredAt).toEqual(CREATED_AT);
    // The conditional update is what keeps a stale ack from lowering it.
    expect(args.where.OR).toEqual([
      { lastDeliveredAt: null },
      { lastDeliveredAt: { lt: CREATED_AT } },
    ]);
    expect(mockPublishDelivered).toHaveBeenCalledWith(
      "convo-1",
      "user1",
      CREATED_AT.toISOString()
    );
  });

  test("is a no-op when the watermark already covers the message", async () => {
    mockUpdateMany.mockReturnValueOnce({ count: 0 });
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(200);
    expect(mockPublishDelivered).not.toHaveBeenCalled();
  });

  test("keeps the ack successful when the publish fails", async () => {
    mockPublishDelivered.mockImplementationOnce(() =>
      Promise.reject(new Error("redis down"))
    );
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(200);
  });
});

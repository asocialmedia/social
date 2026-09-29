import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
// Prisma 8: the message is read through a chainable orm query, and the
// watermark is advanced with updateAndCount (which resolves to a row count).
const mockMessageFirst = mock((): unknown => null);
const mockUpdateAndCount = mock(() => 1);
let lastMemberWhere: Record<string, unknown> | null = null;
let lastWatermark: unknown = null;
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
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  fromPrismaDateTime: (value: Date) => value,
  or: (...conditions: unknown[]) => conditions.filter(Boolean),
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          where: (
            predicate: (member: {
              conversationId: { eq: (id: string) => unknown };
              lastDeliveredAt: {
                isNull: () => unknown;
                lt: (value: unknown) => unknown;
              };
              userId: { eq: (id: string) => unknown };
            }) => unknown
          ) => {
            const captured: Record<string, unknown> = {};
            const field = (name: string) => ({
              eq: (value: string) => {
                captured[name] = value;
                return {};
              },
              isNull: () => {
                captured[name] = { isNull: true };
                return {};
              },
              lt: (value: unknown) => {
                captured[name] = { lt: value };
                return {};
              },
            });
            predicate({
              conversationId: field("conversationId"),
              lastDeliveredAt: field("lastDeliveredAt"),
              userId: field("userId"),
            } as never);
            lastMemberWhere = captured;
            return {
              updateAndCount: (value: Record<string, unknown>) => {
                lastWatermark = value.lastDeliveredAt;
                return mockUpdateAndCount();
              },
            };
          },
        },
        Messages: {
          select: () => ({ where: () => ({ first: mockMessageFirst }) }),
        },
      },
    },
  },
  publishConversationDelivered: mockPublishDelivered,
  toPrismaDateTime: (value: Date) => value,
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
    mockMessageFirst.mockReset();
    mockMessageFirst.mockImplementation(() => ({
      createdAt: CREATED_AT,
      senderId: "user2",
    }));
    mockUpdateAndCount.mockReset();
    mockUpdateAndCount.mockImplementation(() => 1);
    lastMemberWhere = null;
    lastWatermark = null;
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
    mockMessageFirst.mockReturnValueOnce(null);
    const res = await POST(deliveredRequest({ messageId: "ghost" }), params);
    expect(res.status).toBe(404);
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("does not move the watermark for the acker's own message", async () => {
    mockMessageFirst.mockReturnValueOnce({
      createdAt: CREATED_AT,
      senderId: "user1",
    });
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(200);
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
    expect(mockPublishDelivered).not.toHaveBeenCalled();
  });

  test("advances the watermark monotonically and publishes", async () => {
    const res = await POST(deliveredRequest({ messageId: "m1" }), params);
    expect(res.status).toBe(200);
    expect(lastMemberWhere?.conversationId).toBe("convo-1");
    expect(lastMemberWhere?.userId).toBe("user1");
    expect(lastWatermark).toEqual(CREATED_AT);
    // The conditional update is what keeps a stale ack from lowering it.
    expect(lastMemberWhere?.lastDeliveredAt).toEqual({
      lt: CREATED_AT,
    });
    expect(mockPublishDelivered).toHaveBeenCalledWith(
      "convo-1",
      "user1",
      CREATED_AT.toISOString()
    );
  });

  test("is a no-op when the watermark already covers the message", async () => {
    mockUpdateAndCount.mockReturnValueOnce(0);
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

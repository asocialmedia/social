import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_MESSAGE_HIDE_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockCommitHides = mock(
  (_input: { conversationId: string; messageIds: string[]; userId: string }) =>
    Promise.resolve({
      changes: [],
      hidden: 0,
      status: "committed" as const,
      unreadDecrement: 0,
    })
);
const mockDecrement = mock((_userId: string, _count: number) => 0);
const limiter = messageRouteLimiter();

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === "convo-1" && userId === "user1"
      ? { id: "convo-1", members: [{ userId: "user1" }] }
      : null,
  hasLeftConversation: () => false,
  leftConversationResponse: () =>
    Response.json(
      { code: "MEMBERSHIP_ENDED", error: "You no longer have access." },
      { status: 403 }
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
  commitMessageHides: mockCommitHides,
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
    mockCommitHides.mockReset();
    mockCommitHides.mockImplementation(() =>
      Promise.resolve({
        changes: [],
        hidden: 0,
        status: "committed",
        unreadDecrement: 0,
      })
    );
    mockDecrement.mockReset();
    mockDecrement.mockImplementation(() => 0);
    limiter.reset();
  });

  test("requires authentication and conversation membership", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const unauthorized = await POST(
      hideRequest({ messageIds: ["m1"] }),
      params
    );
    expect(unauthorized.status).toBe(401);

    mockGetSession.mockReturnValueOnce({ user: { id: "intruder" } });
    const notFound = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(notFound.status).toBe(404);
  });

  test("rejects malformed, empty, and oversized batches", async () => {
    const invalidBodies = [
      {},
      { messageIds: [] },
      { messageIds: "m1" },
      { messageIds: [null, 1, ""] },
    ];
    const invalidResponses = await Promise.all(
      invalidBodies.map((body) => POST(hideRequest(body), params))
    );
    expect(invalidResponses.every((response) => response.status === 400)).toBe(
      true
    );

    const oversized = await POST(
      hideRequest({
        messageIds: Array.from({ length: 101 }, (_, index) => `m${index}`),
      }),
      params
    );
    expect(oversized.status).toBe(400);
    expect(mockCommitHides).not.toHaveBeenCalled();
  });

  test("deduplicates ids and returns the number actually hidden", async () => {
    mockCommitHides.mockImplementationOnce(() =>
      Promise.resolve({
        changes: [],
        hidden: 1,
        status: "committed",
        unreadDecrement: 0,
      })
    );
    const response = await POST(
      hideRequest({ messageIds: ["m1", "foreign", "m1"] }),
      params
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hidden: 1 });
    expect(mockCommitHides).toHaveBeenCalledWith({
      conversationId: "convo-1",
      messageIds: ["m1", "foreign"],
      userId: "user1",
    });
  });

  test("credits only committed unread hides and tolerates cache failure", async () => {
    mockCommitHides.mockImplementationOnce(() =>
      Promise.resolve({
        changes: [],
        hidden: 2,
        status: "committed",
        unreadDecrement: 1,
      })
    );
    mockDecrement.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    const response = await POST(
      hideRequest({ messageIds: ["m1", "m2"] }),
      params
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hidden: 2 });
    expect(mockDecrement).toHaveBeenCalledWith("user1", 1);
  });

  test("returns a retryable error when the durable transaction fails", async () => {
    mockCommitHides.mockImplementationOnce(() =>
      Promise.reject(new Error("database unavailable"))
    );

    const response = await POST(hideRequest({ messageIds: ["m1"] }), params);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Messages could not be hidden. Please try again.",
    });
    expect(mockDecrement).not.toHaveBeenCalled();
  });

  test("rejects a hide if membership ends before the transaction", async () => {
    mockCommitHides.mockImplementationOnce(() =>
      Promise.resolve({ status: "membership-ended" })
    );

    const response = await POST(hideRequest({ messageIds: ["m1"] }), params);

    expect(response.status).toBe(403);
    expect(mockDecrement).not.toHaveBeenCalled();
  });

  test("spends the hide budget and refuses an over-budget request", async () => {
    const accepted = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(accepted.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([
      DEN_MESSAGE_HIDE_RATE_LIMIT.bucket,
    ]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);

    limiter.reset();
    limiter.setDenied(true);
    const denied = await POST(hideRequest({ messageIds: ["m1"] }), params);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("42");
  });
});

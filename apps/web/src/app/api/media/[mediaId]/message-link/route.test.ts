import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockFindMember = mock(() =>
  Promise.resolve({ conversationId: "convo-1", userId: "user1" })
);
const mockUpdateMany = mock(() => Promise.resolve({ count: 1 }));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: {
    media: { updateMany: mockUpdateMany },
    messageConversationMember: { findUnique: mockFindMember },
  },
}));

function post(mediaId: string, body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/media/link", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ mediaId }) }
  );
}

describe("POST /api/media/:mediaId/message-link", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockFindMember.mockClear();
    mockUpdateMany.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockFindMember.mockReturnValue(
      Promise.resolve({ conversationId: "convo-1", userId: "user1" })
    );
    mockUpdateMany.mockReturnValue(Promise.resolve({ count: 1 }));
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await post("media-1", { conversationId: "convo-1" });
    expect(res.status).toBe(401);
  });

  test("rejects a non-member before touching the row", async () => {
    mockFindMember.mockReturnValueOnce(Promise.resolve(null));
    const res = await post("media-1", { conversationId: "convo-1" });
    expect(res.status).toBe(403);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("rejects an invalid conversation id", async () => {
    const res = await post("media-1", { conversationId: 42 });
    expect(res.status).toBe(400);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("binds the owner's unlinked row only within the caller's conversation", async () => {
    const res = await post("media-1", { conversationId: "convo-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: true, mediaId: "media-1" });

    const args = mockUpdateMany.mock.calls[0]?.[0] as {
      data: { messageConversationId: string };
      where: {
        id: string;
        OR: unknown[];
        status: { in: string[] };
        userId: string;
      };
    };
    expect(args.data.messageConversationId).toBe("convo-1");
    expect(args.where.id).toBe("media-1");
    // Owner-scoped: a row owned by someone else can never be claimed.
    expect(args.where.userId).toBe("user1");
    // Only a null link or the confirmed same link matches; a row bound to a
    // different thread is never moved.
    expect(args.where.OR).toEqual([
      { messageConversationId: null },
      { messageConversationId: "convo-1" },
    ]);
    // Dead pipeline states must stay dead.
    expect(args.where.status.in).not.toContain("DELETED");
    expect(args.where.status.in).not.toContain("REJECTED");
  });

  test("reports linked:false when the row is not claimable", async () => {
    mockUpdateMany.mockReturnValueOnce(Promise.resolve({ count: 0 }));
    const res = await post("media-1", { conversationId: "convo-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: false, mediaId: "media-1" });
  });
});

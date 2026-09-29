import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockFindMember = mock(() =>
  Promise.resolve({ conversationId: "convo-1", userId: "user1" })
);
// The media filter the route composed, captured so the ownership and lifecycle
// guards can be asserted.
let lastMediaFilter: {
  status: string[];
  userId: string;
} | null = null;
// The (conversationId, userId) pair the membership check filtered on.
let _lastMemberScope: Record<string, string> = {};
const mockUpdateAndCount = mock(() => Promise.resolve({ count: 1 }));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  or: (...conditions: unknown[]) => conditions.filter(Boolean),
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          select: () => ({
            where: (
              predicate: (row: {
                conversationId: { eq: (id: string) => unknown };
                userId: { eq: (id: string) => unknown };
              }) => unknown
            ) => {
              const captured: Record<string, string> = {};
              const field = (name: string) => ({
                eq: (value: string) => {
                  captured[name] = value;
                  return {};
                },
              });
              predicate({
                conversationId: field("conversationId"),
                userId: field("userId"),
              } as never);
              _lastMemberScope = captured;
              return { first: () => mockFindMember() };
            },
          }),
        },
        PostMedia: {
          // The ownership + lifecycle guard arrives as a predicate, so it is
          // invoked against a recording accessor to capture what it filtered on.
          where: (
            predicate: (media: {
              id: { eq: (value: string) => unknown };
              messageConversationId: {
                eq: (value: string) => unknown;
                isNull: () => unknown;
              };
              status: { in: (values: string[]) => unknown };
              userId: { eq: (value: string) => unknown };
            }) => unknown
          ) => {
            const captured = { status: [] as string[], userId: "" };
            predicate({
              id: { eq: () => ({}) },
              messageConversationId: { eq: () => ({}), isNull: () => ({}) },
              status: {
                in: (values: string[]) => {
                  captured.status = values;
                  return {};
                },
              },
              userId: {
                eq: (value: string) => {
                  captured.userId = value;
                  return {};
                },
              },
            } as never);
            lastMediaFilter = captured;
            return { updateAndCount: mockUpdateAndCount };
          },
        },
      },
    },
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
    mockUpdateAndCount.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockFindMember.mockReturnValue(
      Promise.resolve({ conversationId: "convo-1", userId: "user1" })
    );
    mockUpdateAndCount.mockImplementation(() => 1);
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
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("rejects an invalid conversation id", async () => {
    const res = await post("media-1", { conversationId: 42 });
    expect(res.status).toBe(400);
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("binds the owner's unlinked row only within the caller's conversation", async () => {
    const res = await post("media-1", { conversationId: "convo-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: true, mediaId: "media-1" });

    const set = mockUpdateAndCount.mock.calls[0]?.[0] as {
      messageConversationId: string;
    };
    expect(set.messageConversationId).toBe("convo-1");
    // Owner-scoped: a row owned by someone else can never be claimed.
    expect(lastMediaFilter.userId).toBe("user1");
    // Dead pipeline states must stay dead.
    expect(lastMediaFilter.status).not.toContain("DELETED");
    expect(lastMediaFilter.status).not.toContain("REJECTED");
  });

  test("reports linked:false when the row is not claimable", async () => {
    mockUpdateAndCount.mockReturnValueOnce(0);
    const res = await post("media-1", { conversationId: "convo-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: false, mediaId: "media-1" });
  });
});

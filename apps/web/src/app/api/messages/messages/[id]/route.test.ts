import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DELETE, PATCH } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockAreBlocked = mock(() => false);
const mockIsWithinEditWindow = mock(() => true);

// Prisma 8: reads go through chainable orm queries, the global delete is a
// plain update, and the edit is a conditional updateAndCount (a row count).
const mockMessageFirst = mock((): unknown => null);
const mockUpdate = mock((_args: unknown) => ({}));
const mockUpdateAndCount = mock(() => 1);
// The where the edit composed, captured so its guards can be asserted.
let lastEditWhere: Record<string, unknown> = {};
let lastEditSet: Record<string, unknown> = {};
const mockPublishEdited = mock(() => Promise.resolve());
const mockPublishDeleted = mock(() => Promise.resolve());

const baseMessage = {
  conversation: {
    messageConversationMembers: [{ userId: "user1" }, { userId: "user2" }],
  },
  conversationId: "convo-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  id: "msg-1",
  senderId: "user1",
};

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  areBlocked: mockAreBlocked,
  messageSenderSelect: () => ({ sender: true }),
  parseJsonBody: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
}));

mock.module("@/lib/messages/edit-window", () => ({
  MAX_MESSAGE_CIPHERTEXT_LENGTH: 100_000,
  MESSAGE_EDIT_WINDOW_MS: 12 * 60 * 60 * 1000,
  isWithinEditWindow: mockIsWithinEditWindow,
}));

mock.module("@asm/db", () => ({
  and: (...conditions: unknown[]) =>
    Object.assign({}, ...(conditions.filter(Boolean) as object[])),
  fromPrismaDateTime: (value: Date) => value,
  prisma: {
    orm: {
      public: {
        Messages: {
          include: () => ({ first: () => mockMessageFirst() }),
          select: () => ({ where: () => ({ first: mockMessageFirst }) }),
          where: (filter?: ((row: unknown) => unknown) | object) => {
            if (typeof filter === "function") {
              // The edit's conditional update: record the guards it asserted.
              const captured: Record<string, unknown> = {};
              const field = (name: string) => ({
                eq: (value: unknown) => {
                  captured[name] = value;
                  return {};
                },
                gte: (value: unknown) => {
                  captured[name] = { gte: value };
                  return {};
                },
                isNull: () => {
                  captured[name] = null;
                  return {};
                },
              });
              filter({
                createdAt: field("createdAt"),
                deletedAt: field("deletedAt"),
                id: field("id"),
                senderId: field("senderId"),
              } as never);
              lastEditWhere = captured;
              return {
                updateAndCount: (set: Record<string, unknown>) => {
                  lastEditSet = set;
                  return mockUpdateAndCount();
                },
              };
            }
            // The plain-object read (the delete path) includes the conversation
            // and its members, then resolves the row.
            const withConversation = {
              first: mockMessageFirst,
              include: () => withConversation,
              where: () => withConversation,
            };
            return { ...withConversation, update: mockUpdate };
          },
        },
      },
    },
  },
  publishMessageDeleted: mockPublishDeleted,
  publishMessageEdited: mockPublishEdited,
  toPrismaDateTime: (value: Date) => value,
}));

function url() {
  return "http://localhost:3000/api/messages/messages/msg-1";
}

function patchRequest(body: unknown) {
  return new Request(url(), {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

const params = { params: Promise.resolve({ id: "msg-1" }) };

describe("PATCH /api/messages/messages/:id", () => {
  beforeEach(() => {
    mockMessageFirst.mockReset();
    mockUpdate.mockReset();
    mockUpdateAndCount.mockReset();
    mockPublishEdited.mockReset();
    mockPublishDeleted.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockReset();
    mockAreBlocked.mockImplementation(() => false);
    mockIsWithinEditWindow.mockReset();
    mockIsWithinEditWindow.mockImplementation(() => true);
    mockUpdateAndCount.mockImplementation(() => 1);
    mockPublishEdited.mockImplementation(() => Promise.resolve());
    // First findUnique resolves the target, second returns the updated row.
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    mockMessageFirst.mockReturnValueOnce({
      ...baseMessage,
      ciphertext: "new-cipher",
      editedAt: new Date("2026-01-01T01:00:00.000Z"),
      iv: "new-iv",
    });
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(401);
  });

  test("404s an unknown message", async () => {
    mockMessageFirst.mockReset();
    mockMessageFirst.mockReturnValueOnce(null);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(404);
  });

  test("refuses to edit someone else's message", async () => {
    mockMessageFirst.mockReset();
    mockMessageFirst.mockReturnValueOnce({ ...baseMessage, senderId: "user2" });
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(403);
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("rejects a deleted message", async () => {
    mockMessageFirst.mockReset();
    mockMessageFirst.mockReturnValueOnce({
      ...baseMessage,
      deletedAt: new Date(),
    });
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(409);
  });

  test("rejects an edit past the window", async () => {
    mockIsWithinEditWindow.mockReturnValueOnce(false);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(409);
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("rejects an invalid payload", async () => {
    const res = await PATCH(patchRequest({ iv: "i" }), params);
    expect(res.status).toBe(400);
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("rejects an oversized ciphertext", async () => {
    const res = await PATCH(
      patchRequest({ ciphertext: "x".repeat(100_001), iv: "i" }),
      params
    );
    expect(res.status).toBe(413);
  });

  test("blocks an edit after either party blocks", async () => {
    mockAreBlocked.mockReturnValueOnce(true);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(403);
    expect(mockUpdateAndCount).not.toHaveBeenCalled();
  });

  test("rewrites the ciphertext in place and publishes the edit", async () => {
    const res = await PATCH(
      patchRequest({ ciphertext: "new-cipher", iv: "new-iv" }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockUpdateAndCount).toHaveBeenCalledTimes(1);
    // The update is scoped to a live row owned by the caller, so a racing delete
    // or a lapsed window cannot slip through.
    expect(lastEditWhere.deletedAt).toBeNull();
    expect(lastEditWhere.id).toBe("msg-1");
    expect(lastEditWhere.senderId).toBe("user1");
    expect(lastEditSet.ciphertext).toBe("new-cipher");
    expect(lastEditSet.iv).toBe("new-iv");
    expect(lastEditSet.editedAt).toBeInstanceOf(Date);
    // The window is re-asserted at the SQL level, derived from the write time.
    const { gte } = lastEditWhere.createdAt as { gte: Date };
    expect(gte.getTime()).toBe(
      (lastEditSet.editedAt as Date).getTime() - 12 * 60 * 60 * 1000
    );
    // The ratchet index is never part of the update: it is part of the derived
    // message key, so rewriting it would desync every later message.
    expect(lastEditSet).not.toHaveProperty("ratchetIndex");
    expect(mockPublishEdited).toHaveBeenCalledTimes(1);
    expect(mockPublishEdited).toHaveBeenCalledWith(
      "convo-1",
      expect.objectContaining({ ciphertext: "new-cipher" })
    );
  });

  test("409s when the row was deleted between the read and the write", async () => {
    mockUpdateAndCount.mockReturnValueOnce(0);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(409);
    expect(mockPublishEdited).not.toHaveBeenCalled();
  });

  test("keeps the edit successful when the publish fails", async () => {
    mockPublishEdited.mockImplementationOnce(() =>
      Promise.reject(new Error("redis down"))
    );
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/messages/messages/:id", () => {
  beforeEach(() => {
    mockMessageFirst.mockReset();
    mockUpdate.mockReset();
    mockPublishDeleted.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockReset();
    mockAreBlocked.mockImplementation(() => false);
  });

  test("soft-deletes and publishes", async () => {
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    mockUpdate.mockReturnValueOnce({ id: "msg-1" });
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockPublishDeleted).toHaveBeenCalledTimes(1);
  });

  test("refuses to delete someone else's message for everyone", async () => {
    // "Delete for everyone" is sender-only; a receiver must use the per-user
    // hide endpoint instead.
    mockMessageFirst.mockReturnValueOnce({ ...baseMessage, senderId: "user2" });
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPublishDeleted).not.toHaveBeenCalled();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(401);
  });
});

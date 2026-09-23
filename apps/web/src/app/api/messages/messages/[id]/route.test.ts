import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DELETE, PATCH } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockAreBlocked = mock(() => false);
const mockIsWithinEditWindow = mock(() => true);

const mockFindUnique = mock((_args: unknown): unknown => null);
const mockUpdate = mock((_args: unknown) => ({}));
const mockUpdateMany = mock((_args: unknown) => ({ count: 1 }));
const mockPublishEdited = mock(() => Promise.resolve());
const mockPublishDeleted = mock(() => Promise.resolve());

const baseMessage = {
  conversation: {
    members: [{ userId: "user1" }, { userId: "user2" }],
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
  prisma: {
    message: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      updateMany: mockUpdateMany,
    },
  },
  publishMessageDeleted: mockPublishDeleted,
  publishMessageEdited: mockPublishEdited,
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
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdateMany.mockReset();
    mockPublishEdited.mockReset();
    mockPublishDeleted.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockReset();
    mockAreBlocked.mockImplementation(() => false);
    mockIsWithinEditWindow.mockReset();
    mockIsWithinEditWindow.mockImplementation(() => true);
    mockUpdateMany.mockImplementation(() => ({ count: 1 }));
    mockPublishEdited.mockImplementation(() => Promise.resolve());
    // First findUnique resolves the target, second returns the updated row.
    mockFindUnique.mockReturnValueOnce(baseMessage);
    mockFindUnique.mockReturnValueOnce({
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
    mockFindUnique.mockReset();
    mockFindUnique.mockReturnValueOnce(null);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(404);
  });

  test("refuses to edit someone else's message", async () => {
    mockFindUnique.mockReset();
    mockFindUnique.mockReturnValueOnce({ ...baseMessage, senderId: "user2" });
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(403);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("rejects a deleted message", async () => {
    mockFindUnique.mockReset();
    mockFindUnique.mockReturnValueOnce({
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
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("rejects an invalid payload", async () => {
    const res = await PATCH(patchRequest({ iv: "i" }), params);
    expect(res.status).toBe(400);
    expect(mockUpdateMany).not.toHaveBeenCalled();
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
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("rewrites the ciphertext in place and publishes the edit", async () => {
    const res = await PATCH(
      patchRequest({ ciphertext: "new-cipher", iv: "new-iv" }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const args = mockUpdateMany.mock.calls[0]?.[0] as {
      data: { ciphertext: string; editedAt: Date; iv: string };
      where: {
        createdAt: { gte: Date };
        deletedAt: null;
        id: string;
        senderId: string;
      };
    };
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.id).toBe("msg-1");
    expect(args.where.senderId).toBe("user1");
    // The window is re-asserted at the SQL level, derived from the write time.
    expect(args.where.createdAt.gte.getTime()).toBe(
      args.data.editedAt.getTime() - 12 * 60 * 60 * 1000
    );
    expect(args.data.ciphertext).toBe("new-cipher");
    expect(args.data.iv).toBe("new-iv");
    expect(args.data.editedAt).toBeInstanceOf(Date);
    // The ratchet index is never part of the update: changing it would desync
    // the key derivation for every later message.
    expect(args.data).not.toHaveProperty("ratchetIndex");
    expect(mockPublishEdited).toHaveBeenCalledTimes(1);
    expect(mockPublishEdited).toHaveBeenCalledWith(
      "convo-1",
      expect.objectContaining({ ciphertext: "new-cipher" })
    );
  });

  test("409s when the row was deleted between the read and the write", async () => {
    mockUpdateMany.mockReturnValueOnce({ count: 0 });
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
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockPublishDeleted.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockReset();
    mockAreBlocked.mockImplementation(() => false);
  });

  test("soft-deletes and publishes", async () => {
    mockFindUnique.mockReturnValueOnce(baseMessage);
    mockUpdate.mockReturnValueOnce({ id: "msg-1" });
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockPublishDeleted).toHaveBeenCalledTimes(1);
  });

  test("refuses to delete someone else's message for everyone", async () => {
    // "Delete for everyone" is sender-only; a receiver must use the per-user
    // hide endpoint instead.
    mockFindUnique.mockReturnValueOnce({ ...baseMessage, senderId: "user2" });
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

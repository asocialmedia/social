import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET, POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockAreBlocked = mock(() => false);
const mockNextRatchetIndex = mock(() => 0);

const mockMessages: Record<string, unknown>[] = [];
const mockCreate = mock((args: { data: Record<string, unknown> }) => {
  const message = {
    id: "msg-1",
    sender: { id: "user1" },
    ...args.data,
  };
  mockMessages.push(message);
  return message;
});
const mockFindMany = mock(() => []);
const mockIncrement = mock(() => 1);
const mockPublishCreated = mock(() => Promise.resolve());

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  areBlocked: mockAreBlocked,
  getConversationForUser: (conversationId: string, userId: string) =>
    conversationId === "convo-1" && userId === "user1"
      ? {
          id: "convo-1",
          members: [{ userId: "user1" }, { userId: "user2" }],
        }
      : null,
  messageSenderSelect: () => ({ sender: true }),
  nextRatchetIndex: mockNextRatchetIndex,
}));

mock.module("@asm/db", () => ({
  prisma: {
    message: {
      create: mockCreate,
      findMany: mockFindMany,
    },
  },
  publishMessageCreated: mockPublishCreated,
  unreadMessageCache: { increment: mockIncrement },
}));

function convoUrl(path: string) {
  return `http://localhost:3000/api/messages/conversations/convo-1/${path}`;
}

describe("POST /api/messages/conversations/:id/messages", () => {
  beforeEach(() => {
    mockMessages.length = 0;
    mockCreate.mockClear();
    mockFindMany.mockClear();
    mockIncrement.mockClear();
    mockPublishCreated.mockClear();
    mockNextRatchetIndex.mockClear();
    mockNextRatchetIndex.mockReturnValue(0);
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(
      new Request(convoUrl("messages"), { method: "POST" }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(401);
  });

  test("rejects invalid ciphertext payloads", async () => {
    const res = await POST(
      new Request(convoUrl("messages"), {
        body: JSON.stringify({ iv: "abc" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(400);
  });

  test("rejects a stale ratchet index with 409 and the expected value", async () => {
    mockNextRatchetIndex.mockReturnValueOnce(4);
    const res = await POST(
      new Request(convoUrl("messages"), {
        body: JSON.stringify({
          ciphertext: "abc",
          iv: "def",
          ratchetIndex: 3,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { expectedIndex: number };
    expect(body.expectedIndex).toBe(4);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("blocks sends after either party blocks", async () => {
    mockAreBlocked.mockReturnValueOnce(true);
    const res = await POST(
      new Request(convoUrl("messages"), {
        body: JSON.stringify({
          ciphertext: "abc",
          iv: "def",
          ratchetIndex: 0,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(403);
  });

  test("stores the server-authoritative ratchet index and notifies the peer", async () => {
    const res = await POST(
      new Request(convoUrl("messages"), {
        body: JSON.stringify({
          ciphertext: "abc",
          iv: "def",
          ratchetIndex: 0,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ id: "convo-1" }) }
    );
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0]?.[0] as {
      data: { conversationId: string; ratchetIndex: number; senderId: string };
    };
    expect(createArgs.data.conversationId).toBe("convo-1");
    expect(createArgs.data.ratchetIndex).toBe(0);
    expect(createArgs.data.senderId).toBe("user1");
    // The peer accrues unread; the sender does not.
    expect(mockIncrement).toHaveBeenCalledWith("user2");
    expect(mockPublishCreated).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/messages/conversations/:id/messages", () => {
  test("returns the page and a cursor for older messages", async () => {
    mockFindMany.mockReturnValueOnce([
      { id: "newer" },
      { id: "older" },
      { id: "oldest" },
    ]);
    const res = await GET(new Request(convoUrl("messages")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    const body = (await res.json()) as {
      messages: { id: string }[];
      previousCursor: string | null;
    };
    // Newest-first on the wire, oldest-first in the payload.
    expect(body.messages.map((m) => m.id)).toEqual([
      "oldest",
      "older",
      "newer",
    ]);
    expect(body.previousCursor).toBeNull();
  });
});

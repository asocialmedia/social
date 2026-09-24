import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET, POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockAreBlocked = mock(() => false);
const mockNextRatchetIndex = mock(() => 0);

const mockMessages: Record<string, unknown>[] = [];
const mockCreate = mock((args: Record<string, unknown>) => {
  const data =
    "data" in args && typeof args.data === "object" && args.data !== null
      ? (args.data as Record<string, unknown>)
      : args;
  const message = {
    id: "msg-1",
    sender: { id: "user1" },
    ...data,
  };
  mockMessages.push(message);
  return message;
});
const mockFindMany = mock(() => []);
const mockMessageFirst = mock(() => mockMessages.at(-1) ?? null);
const mockIncrement = mock(() => 1);
const mockPublishCreated = mock(() => Promise.resolve());
const mockKeyFirst = mock(() => ({ ratchetCounter: 0 }));
const mockKeyUpdateAndCount = mock(() => 1);
const mockConversationUpdate = mock(() => ({}));
const mockTransaction = mock((fn: (tx: unknown) => unknown) => fn(txClient));

const txClient = {
  message: { create: mockCreate },
  messageConversation: { update: mockConversationUpdate },
  messageConversationKey: { updateMany: mockKeyUpdateAndCount },
  orm: {
    public: {
      MessageConversationKeys: {
        select: () => ({
          where: () => ({ first: mockKeyFirst }),
        }),
        where: () => ({ updateAndCount: mockKeyUpdateAndCount }),
      },
      MessageConversations: {
        where: () => ({ update: mockConversationUpdate }),
      },
      Messages: { create: mockCreate },
    },
  },
};

mock.module("@/lib/auth/session", () => ({
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
  and: (...conditions: unknown[]) => conditions,
  fromPrismaDateTime: (value: Date) => value,
  getMessageDataQuery: () => {
    const query = {
      all: () => mockFindMany(),
      first: () => mockMessageFirst(),
      limit: () => query,
      orderBy: () => query,
      where: () => query,
    };
    return query;
  },
  prisma: {
    message: {
      create: mockCreate,
      findMany: mockFindMany,
    },
    transaction: mockTransaction,
  },
  publishMessageCreated: mockPublishCreated,
  toPrismaDateTime: (value: Date) => value,
  unreadMessageCache: { increment: mockIncrement },
}));

function convoUrl(path: string) {
  return `http://localhost:3000/api/messages/conversations/convo-1/${path}`;
}

function validPostRequest() {
  return new Request(convoUrl("messages"), {
    body: JSON.stringify({ ciphertext: "abc", iv: "def", ratchetIndex: 0 }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/messages/conversations/:id/messages", () => {
  beforeEach(() => {
    mockMessages.length = 0;
    mockCreate.mockClear();
    mockFindMany.mockClear();
    mockIncrement.mockClear();
    mockPublishCreated.mockClear();
    mockNextRatchetIndex.mockClear();
    mockKeyUpdateAndCount.mockClear();
    mockConversationUpdate.mockClear();
    mockTransaction.mockClear();
    mockGetSession.mockClear();
    mockNextRatchetIndex.mockReturnValue(0);
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(txClient)
    );
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
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
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { expectedIndex: number };
    expect(body.expectedIndex).toBe(4);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("blocks sends after either party blocks", async () => {
    mockAreBlocked.mockReturnValueOnce(true);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("stores the server-authoritative ratchet index and notifies the peer", async () => {
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0]?.[0] as {
      conversationId: string;
      ratchetIndex: number;
      senderId: string;
    };
    expect(createArgs.conversationId).toBe("convo-1");
    expect(createArgs.ratchetIndex).toBe(0);
    expect(createArgs.senderId).toBe("user1");
    expect(mockKeyUpdateAndCount).toHaveBeenCalledWith({
      ratchetCounter: 1,
    });
    expect(mockConversationUpdate).toHaveBeenCalledWith({
      updatedAt: expect.any(Date),
    });
    // The peer accrues unread; the sender does not.
    expect(mockIncrement).toHaveBeenCalledWith("user2");
    expect(mockPublishCreated).toHaveBeenCalledTimes(1);
  });

  test("keeps a committed send successful when redis side effects fail", async () => {
    mockIncrement.mockImplementationOnce(() => {
      throw new Error("redis down");
    });
    mockPublishCreated.mockImplementationOnce(() =>
      Promise.reject(new Error("publish down"))
    );
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test("returns 409 with a fresh index when the unique constraint rejects the create", async () => {
    mockTransaction.mockImplementationOnce(() => {
      throw Object.assign(new Error("unique constraint"), { code: "P2002" });
    });
    mockNextRatchetIndex.mockReturnValueOnce(1);
    const res = await POST(validPostRequest(), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { expectedIndex: number };
    expect(body.expectedIndex).toBe(1);
  });
});

describe("GET /api/messages/conversations/:id/messages", () => {
  beforeEach(() => {
    mockFindMany.mockClear();
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
  });

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

  test("caps a page at PAGE_SIZE and reports hasMore via previousCursor", async () => {
    // PAGE_SIZE + 1 rows -> one is withheld and the last visible row becomes
    // the previous cursor.
    const rows = Array.from({ length: 31 }, (_, index) => ({
      id: `m-${String(index).padStart(3, "0")}`,
    }));
    mockFindMany.mockReturnValueOnce(rows);
    const res = await GET(new Request(convoUrl("messages")), {
      params: Promise.resolve({ id: "convo-1" }),
    });
    const body = (await res.json()) as {
      messages: { id: string }[];
      previousCursor: string | null;
    };
    expect(body.messages).toHaveLength(30);
    // The 30th (last) visible row becomes the cursor for the previous page.
    expect(body.previousCursor).toBe("m-029");
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test("passes the cursor through as an id.lt filter", async () => {
    mockFindMany.mockReturnValueOnce([{ id: "m-010" }]);
    const req = new Request(convoUrl("messages?cursor=m-020"), {
      method: "GET",
    });
    await GET(req, { params: Promise.resolve({ id: "convo-1" }) });
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });
});

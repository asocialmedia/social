import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));

const createdConversations: Record<string, unknown>[] = [];
const mockCreate = mock((args: { data: Record<string, unknown> }) => {
  const conversation = {
    id: "convo-1",
    keys: [],
    members: [{ userId: "user1" }, { userId: "user2" }],
    ...args.data,
  };
  createdConversations.push(conversation);
  return conversation;
});
const mockFindFirst = mock(() => null);
const mockFindUniqueUser = mock((args: { where: { id: string } }) =>
  args.where.id === "user2" ? { id: "user2" } : null
);

const mockFollowFindUnique = mock(() => ({ followerId: "user1" }));
const mockAreBlocked = mock(() => false);
const mockHasMessageIdentity = mock(
  (userId: string) => userId !== "no-identity"
);

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  areBlocked: mockAreBlocked,
  getConversationMembersInclude: () => ({ members: true }),
  hasMessageIdentity: mockHasMessageIdentity,
}));

mock.module("@asm/db", () => ({
  prisma: {
    follow: { findUnique: mockFollowFindUnique },
    messageConversation: {
      create: mockCreate,
      findFirst: mockFindFirst,
    },
    user: { findUnique: mockFindUniqueUser },
  },
}));

function postWith(recipientId?: string) {
  const req = new Request("http://localhost:3000/api/messages/conversations", {
    body: JSON.stringify({ recipientId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return POST(req);
}

describe("POST /api/messages/conversations", () => {
  beforeEach(() => {
    createdConversations.length = 0;
    mockCreate.mockClear();
    mockFindFirst.mockClear();
    mockFindUniqueUser.mockClear();
    mockFollowFindUnique.mockClear();
    mockAreBlocked.mockClear();
    mockHasMessageIdentity.mockClear();
    mockHasMessageIdentity.mockImplementation(
      (userId: string) => userId !== "no-identity"
    );
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await postWith("user2");
    expect(res.status).toBe(401);
  });

  test("rejects missing, self, or unknown recipients", async () => {
    const missing = await postWith();
    expect(missing.status).toBe(400);
    const self = await postWith("user1");
    expect(self.status).toBe(400);
    const ghost = await postWith("ghost");
    expect(ghost.status).toBe(404);
  });

  test("enforces the follow-only rule", async () => {
    mockFollowFindUnique.mockReturnValueOnce(null);
    const res = await postWith("user2");
    expect(res.status).toBe(403);
  });

  test("rejects blocked pairs", async () => {
    mockAreBlocked.mockReturnValueOnce(true);
    const res = await postWith("user2");
    expect(res.status).toBe(403);
  });

  test("requires both sides to have enabled messages", async () => {
    mockHasMessageIdentity.mockImplementation(
      (userId: string) => userId === "user1"
    );
    const res = await postWith("user2");
    expect(res.status).toBe(409);
  });

  test("creates a conversation when none exists", async () => {
    const res = await postWith("user2");
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      conversation: { id: string };
      isNew: boolean;
    };
    expect(body.isNew).toBe(true);
    expect(body.conversation.id).toBe("convo-1");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0]?.[0] as {
      data: { members: { create: unknown[] } };
    };
    expect(createArgs.data.members.create).toHaveLength(2);
  });

  test("returns the existing conversation on create-or-find", async () => {
    mockFindFirst.mockReturnValueOnce({
      id: "existing-convo",
      keys: [],
      members: [],
    });
    const res = await postWith("user2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversation: { id: string };
      isNew: boolean;
    };
    expect(body.isNew).toBe(false);
    expect(body.conversation.id).toBe("existing-convo");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

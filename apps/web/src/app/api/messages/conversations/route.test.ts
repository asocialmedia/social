import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));

const createdConversations: Record<string, unknown>[] = [];
const mockCreate = mock((args: { data: Record<string, unknown> }) => {
  const conversation = {
    id: "convo-1",
    keys: [],
    members: [{ userId: "user1" }, { userId: "user2" }],
    ...args.data,
  };
  createdConversations.push(conversation);
  createdConversation = queryConversation("convo-1");
  return Promise.resolve(conversation);
});
interface ConversationRow {
  id: string;
  keys: unknown[];
  members: unknown[];
}

interface ConversationWhereCall {
  excludedUserIds: string[];
  includedUserIds: string[];
}

const conversationWhereCalls: ConversationWhereCall[] = [];
const mockFindFirst = mock((): ConversationRow | null => null);
let createdConversation: Record<string, unknown> | null = null;

function queryConversation(id: string): Record<string, unknown> {
  return {
    createdAt: new Date(),
    id,
    messageConversationKeys: [],
    messageConversationMembers: [
      {
        conversationId: id,
        lastReadAt: null,
        user: {
          avatarUrl: null,
          badge: null,
          badges: [],
          communityMembers: [],
          communityMemberships: [],
          displayName: "User",
          id: "user1",
          messageIdentities: null,
          username: "user1",
        },
        userId: "user1",
      },
    ],
    messages: [],
    pairKey: "user1:user2",
    updatedAt: new Date(),
  };
}
const mockFindUniqueUser = mock((args: { where: { id: string } }) =>
  args.where.id === "user2" ? { id: "user2" } : null
);

const mockFollowFindUnique = mock(() => ({ followerId: "user1" }));
const mockAreBlocked = mock(() => false);
const mockHasMessageIdentity = mock(
  (userId: string) => userId !== "no-identity"
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  areBlocked: mockAreBlocked,
  getConversationMembersInclude: () => ({ members: true }),
  hasMessageIdentity: mockHasMessageIdentity,
  isUniqueConstraintViolation: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002",
  parseJsonBody: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  getMessageConversationDataQuery: () => ({
    where: (where: unknown) => {
      if (typeof where === "function") {
        const call: ConversationWhereCall = {
          excludedUserIds: [],
          includedUserIds: [],
        };
        const predicate = where as (conversation: {
          messageConversationMembers: {
            none: (
              predicate: (member: {
                userId: { notIn: (ids: string[]) => unknown };
              }) => unknown
            ) => unknown;
            some: (
              predicate: (member: {
                userId: { eq: (id: string) => unknown };
              }) => unknown
            ) => unknown;
          };
        }) => unknown;
        predicate({
          messageConversationMembers: {
            none: (memberPredicate) => {
              memberPredicate({
                userId: {
                  notIn: (ids) => {
                    call.excludedUserIds.push(...ids);
                    return { op: "notIn", value: ids };
                  },
                },
              });
              return {};
            },
            some: (memberPredicate) => {
              memberPredicate({
                userId: {
                  eq: (id) => {
                    call.includedUserIds.push(id);
                    return { op: "eq", value: id };
                  },
                },
              });
              return {};
            },
          },
        });
        conversationWhereCalls.push(call);
      }
      const query = {
        first: () => {
          const row = mockFindFirst();
          if (row) {
            return Promise.resolve(
              "createdAt" in row ? row : queryConversation(row.id)
            );
          }
          return Promise.resolve(createdConversation);
        },
        orderBy: () => query,
      };
      return query;
    },
  }),
  prisma: {
    orm: {
      public: {
        Follows: {
          select: () => ({
            where: () => ({ first: mockFollowFindUnique }),
          }),
        },
        MessageConversationMembers: {
          create: () => Promise.resolve({}),
        },
        MessageConversations: {
          create: (data: Record<string, unknown>) => mockCreate({ data }),
        },
        Users: {
          select: () => ({
            where: (where: { id: string }) => ({
              first: () => mockFindUniqueUser({ where }),
            }),
          }),
        },
      },
    },
    transaction: (
      operation: (tx: {
        orm: { public: Record<string, unknown> };
      }) => Promise<unknown>
    ) =>
      operation({
        orm: {
          public: {
            MessageConversationMembers: { create: () => Promise.resolve({}) },
            MessageConversations: {
              create: (data: Record<string, unknown>) => mockCreate({ data }),
            },
          },
        },
      }),
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
    createdConversation = null;
    conversationWhereCalls.length = 0;
    mockCreate.mockClear();
    mockFindFirst.mockClear();
    mockFindUniqueUser.mockClear();
    mockFollowFindUnique.mockClear();
    mockAreBlocked.mockClear();
    mockHasMessageIdentity.mockClear();
    mockGetSession.mockClear();
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
      data: { pairKey: string };
    };
    expect(createArgs.data.pairKey).toBe("user1:user2");
  });

  test("looks up membership by both user ids before creating", async () => {
    await postWith("user2");
    expect(mockFindFirst).toHaveBeenCalled();
    expect(conversationWhereCalls).toHaveLength(1);
    expect(conversationWhereCalls[0]).toEqual({
      excludedUserIds: ["user1", "user2"],
      includedUserIds: ["user1", "user2"],
    });
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

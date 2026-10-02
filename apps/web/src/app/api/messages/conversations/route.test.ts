// Two tests below re-run the SAME route against a shared module-level fixture, so
// their reads are sequential by construction: each pass rewrites the fixture and
// the next pass reads what that rewrite produced. Running them in parallel would
// interleave the writes with the reads, and the assertions would be about nothing.
// oxlint-disable no-await-in-loop
import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  DEN_CREATE_RATE_LIMIT,
  DEN_DM_CREATE_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET, POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));

const createdConversations: Record<string, unknown>[] = [];
// The counter a freshly written conversation reports. Non-zero so a test can tell
// a reported value from an absent one: a DM that never gains a member starts at 0
// in the database, but the create route's own row is read back through the mapper,
// and the point here is that the value survives that read.
const CREATED_MEMBERSHIP_SEQ = 5;

const mockCreate = mock((args: { data: Record<string, unknown> }) => {
  limiter.service("create-conversation");
  const conversation = {
    id: "convo-1",
    keys: [],
    members: [{ userId: "user1" }, { userId: "user2" }],
    ...args.data,
  };
  createdConversations.push(conversation);
  createdConversation = queryConversation("convo-1", CREATED_MEMBERSHIP_SEQ);
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

// The GET path's fixtures. One list read answers both the DM and the DEN cases,
// because the point of the filter is that a single list has to treat them
// differently.
let conversationPage: Record<string, unknown>[] = [];
let blockedOutbound: string[] = [];
let blockedInbound: string[] = [];
let unreadConversationIds: string[] = [];
// The watermark branches the grouped read was given, recorded so the mute and
// unread rules can be asserted without inferring them from the number.
let lastUnreadBranches: { conversationId: string; createdAfter: Date }[] = [];
let _lastUnreadSenderIds: string[] | null = null;

// The accessor surface the grouped unread read is driven against. Recording the
// per-branch watermark is how a test can see that each conversation's OWN
// read marker bounded it, rather than one global earliest - a global bound would
// let a never-read thread pull in every message on the page.
interface MessagePredicate {
  conversationId: { eq: (id: string) => unknown };
  createdAt: { gt: (value: Date) => unknown };
  deletedAt: { isNull: () => unknown };
  hiddenFor: { none: (predicate: (hidden: unknown) => unknown) => unknown };
  senderId: { notIn: (ids: string[]) => unknown };
}

// The list URL. Module scope because it captures nothing.
function listRequest(query = "") {
  return GET(
    new Request(`http://localhost:3000/api/messages/conversations${query}`)
  );
}

// Read the list and assert it answered, so each test can talk about the payload
// rather than about the status code it already knows.
async function readList(query = "") {
  const res = await listRequest(query);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    conversations: {
      id: string;
      inviteCode: string | null;
      membershipSeq: number;
      type: string;
    }[];
    items: {
      conversation: {
        id: string;
        inviteCode: string | null;
        membershipSeq: number;
      };
      lastMessage: unknown;
      unreadCount: number;
    }[];
  };
}

const messageAccessors: MessagePredicate & {
  branches: { conversationId: string; createdAfter: Date }[];
  senderIds: (ids: string[]) => unknown;
} = {
  branches: [],
  conversationId: {
    eq: (id) => {
      messageAccessors.branches.push({
        conversationId: id,
        createdAfter: new Date(0),
      });
      return { eq: id };
    },
  },
  createdAt: {
    gt: (value) => {
      const branch = messageAccessors.branches.at(-1);
      if (branch) {
        branch.createdAfter = value;
      }
      return { gt: value };
    },
  },
  deletedAt: { isNull: () => ({ isNull: true }) },
  hiddenFor: {
    none: (relationFilter) => {
      relationFilter({ userId: { eq: () => ({}) } });
      return { none: true };
    },
  },
  senderId: { notIn: () => ({ notIn: [] }) },
};

function memberRow(
  conversationId: string,
  userId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    conversationId,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastReadAt: null,
    mutedAt: null,
    role: "MEMBER",
    user: {
      avatarUrl: null,
      badge: null,
      badges: [],
      communityMembers: [],
      communityMemberships: [],
      displayName: userId,
      id: userId,
      messageIdentities: null,
      username: userId,
    },
    userId,
    ...overrides,
  };
}

function queryConversation(
  id: string,
  membershipSeq = 0
): Record<string, unknown> {
  return {
    _type: "DM",
    avatarMediaId: null,
    createdAt: new Date(),
    createdById: null,
    description: null,
    id,
    inviteCode: null,
    membershipSeq,
    messageConversationKeys: [],
    messageConversationMembers: [memberRow(id, "user1")],
    messages: [],
    name: null,
    ownerId: null,
    pairKey: "user1:user2",
    updatedAt: new Date(),
  };
}

// A conversation as the GET query returns it, with its full roster.
function pageConversation(
  id: string,
  type: "DM" | "DEN",
  memberIds: string[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...queryConversation(id),
    _type: type,
    inviteCode: "abcdefghjkmn",
    messageConversationMembers: memberIds.map((userId) =>
      memberRow(id, userId)
    ),
    ...overrides,
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

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite. The den
// create branch was hitting live Redis through this route too.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

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
  // The REAL role predicate, so the invite-code redaction below is the product's
  // answer and not this file's. `@asm/db/messages/dens` is a different specifier
  // from the mocked barrel and would resolve for real, but a route under test
  // importing the barrel should get the barrel's export either way.
  canManageDen: (role: string) => role === "OWNER" || role === "ADMIN",
  getMessageConversationDataQuery: () => {
    // One chainable query for both verbs. The GET reads a page through
    // include/where/orderBy/limit/all; the POST resolves a single row through
    // where/orderBy/first. Sharing one object is what stops the two from
    // answering about different tables.
    const query = {
      all: () => Promise.resolve(conversationPage),
      cursor: () => query,
      first: () => {
        const row = mockFindFirst();
        if (row) {
          return Promise.resolve(
            "createdAt" in row ? row : queryConversation(row.id)
          );
        }
        return Promise.resolve(createdConversation);
      },
      include: () => query,
      limit: () => query,
      orderBy: () => query,
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
        return query;
      },
    };
    return query;
  },
  // The list route's per-user visibility filter is a no-op for these fixtures:
  // nothing here is hidden, and the filter is exercised in the query that returns
  // the preview messages.
  or: (...conditions: unknown[]) => conditions,
  prisma: {
    orm: {
      public: {
        Blocks: {
          select: (field: string) => ({
            where: (filter: { blockedId?: string; blockerId?: string }) => ({
              all: () => {
                const ids =
                  filter.blockerId === "user1"
                    ? blockedOutbound
                    : blockedInbound;
                return ids.map((id) => ({ [field]: id }));
              },
            }),
          }),
        },
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
          // The keyset cursor anchor.
          select: () => ({
            where: () => ({ first: () => Promise.resolve(null) }),
          }),
        },
        Messages: {
          select: () => ({
            where: (predicate: (message: MessagePredicate) => unknown) => {
              const branches: { conversationId: string; createdAfter: Date }[] =
                [];
              let senderIds: string[] | null = null;
              messageAccessors.branches = branches;
              messageAccessors.senderIds = (ids) => {
                senderIds = ids;
                return { notIn: ids };
              };
              lastUnreadBranches = branches;
              _lastUnreadSenderIds = senderIds;
              return {
                all: () => {
                  predicate(messageAccessors);
                  return unreadConversationIds.map((conversationId) => ({
                    conversationId,
                  }));
                },
              };
            },
          }),
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
    limiter.reset();
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

  test("reports the roster counter on the conversation it just created", async () => {
    // A create is a membership mutation too, so the client's guard has to learn
    // from this response that the server has already moved the row forward -
    // otherwise the very first send in a brand new conversation decides against a
    // snapshot the server had overtaken.
    const res = await postWith("user2");
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      conversation: { membershipSeq: number };
    };
    expect(body.conversation.membershipSeq).toBe(CREATED_MEMBERSHIP_SEQ);
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

// The GET list is a consolidated surface: one route answers the whole inbox for
// every client on load, and it makes two decisions that only the shared predicates
// make correctly - which conversations a block hides, and what a member is allowed
// to see about a den. Both were untested, and a rule with no test is a rule that
// only exists in the file it was written in.
describe("GET /api/messages/conversations", () => {
  beforeEach(() => {
    conversationPage = [];
    blockedOutbound = [];
    blockedInbound = [];
    unreadConversationIds = [];
    lastUnreadBranches = [];
    _lastUnreadSenderIds = null;
    conversationWhereCalls.length = 0;
    createdConversation = null;
    mockFindFirst.mockClear();
    mockFindFirst.mockImplementation(() => null);
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await listRequest();
    expect(res.status).toBe(401);
  });

  test("hides a blocked DM from the person who blocked", async () => {
    conversationPage = [pageConversation("dm-1", "DM", ["user1", "user2"])];
    blockedOutbound = ["user2"];
    const body = await readList();
    expect(body.items).toEqual([]);
    expect(body.conversations).toEqual([]);
  });

  test("hides a blocked DM from the person who was blocked", async () => {
    // The other direction, because a block is symmetric in its effect and reading
    // only one column pair would leave half the pairs on screen.
    conversationPage = [pageConversation("dm-1", "DM", ["user1", "user2"])];
    blockedInbound = ["user2"];
    const body = await readList();
    expect(body.items).toEqual([]);
  });

  test("keeps an unblocked DM", async () => {
    conversationPage = [pageConversation("dm-1", "DM", ["user1", "user2"])];
    const body = await readList();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.conversation.id).toBe("dm-1");
  });

  test("keeps a den that contains a blocked person, whichever member is first", async () => {
    // The rule, at both roster orders. A den is a room: revoking it because two
    // of its members disagree would hand every other member's access to a private
    // disagreement, and picking one member to test would let that answer depend on
    // which row the query returned first.
    for (const memberIds of [
      ["user1", "user2", "user3"],
      ["user1", "user3", "user2"],
      ["user2", "user1", "user3"],
    ]) {
      conversationPage = [pageConversation("den-1", "DEN", memberIds)];
      blockedOutbound = ["user2"];
      const body = await readList();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.conversation.id).toBe("den-1");
    }
  });

  test("hides the blocked DM and keeps the blocked pair's den in one list", async () => {
    // Both in a single response, which is the shape that matters: the filter is
    // per conversation, and the reader has to be able to see one without the other.
    conversationPage = [
      pageConversation("dm-1", "DM", ["user1", "user2"]),
      pageConversation("den-1", "DEN", ["user1", "user2", "user3"]),
    ];
    blockedOutbound = ["user2"];
    const body = await readList();
    expect(body.items.map((item) => item.conversation.id)).toEqual(["den-1"]);
    // And the hidden conversation is not even asked for its unread count, so a
    // blocked peer's message volume cannot leak through the badge either.
    expect(lastUnreadBranches.map((row) => row.conversationId)).toEqual([
      "den-1",
    ]);
  });

  test("bounds each conversation by its OWN watermark", async () => {
    // A page-wide earliest bound would let one never-read thread pull in every
    // message on the page, which is both wrong and slower.
    const watermark = new Date("2026-02-01T00:00:00Z");
    conversationPage = [
      pageConversation("dm-1", "DM", ["user1", "user2"], {
        messageConversationMembers: [
          memberRow("dm-1", "user1", { lastReadAt: watermark }),
        ],
      }),
      pageConversation("dm-2", "DM", ["user1", "user3"], {
        messageConversationMembers: [memberRow("dm-2", "user1")],
      }),
    ];
    await readList();
    expect(lastUnreadBranches).toEqual([
      { conversationId: "dm-1", createdAfter: watermark },
      { conversationId: "dm-2", createdAfter: new Date(0) },
    ]);
  });

  test("buckets unread rows by conversation and reports a muted thread as read", async () => {
    conversationPage = [
      pageConversation("dm-1", "DM", ["user1", "user2"]),
      pageConversation("dm-2", "DM", ["user1", "user3"], {
        messageConversationMembers: [
          memberRow("dm-2", "user1", { mutedAt: new Date() }),
        ],
      }),
    ];
    unreadConversationIds = ["dm-1", "dm-1", "dm-2"];
    const body = await readList();
    // A muted chat keeps its messages but loses its badge: mute is this member's
    // own preference, so it is applied to the count and not by dropping the
    // thread from the rail.
    expect(
      body.items.find((item) => item.conversation.id === "dm-1")?.unreadCount
    ).toBe(2);
    expect(
      body.items.find((item) => item.conversation.id === "dm-2")?.unreadCount
    ).toBe(0);
  });

  // FIX C. The invite code is the ability to add strangers, and the detail route
  // withholds it from anybody who cannot manage. The list route returned the whole
  // conversation object, so every plain member received it anyway - through the
  // route every client fetches on load.
  test("withholds the invite code from a plain member", async () => {
    conversationPage = [
      pageConversation("den-1", "DEN", ["user1", "user2"], {
        messageConversationMembers: [
          memberRow("den-1", "user1"),
          memberRow("den-1", "user2"),
        ],
      }),
    ];
    const body = await readList();
    expect(body.items[0]?.conversation.inviteCode).toBeNull();
    expect(body.conversations[0]?.inviteCode).toBeNull();
  });

  test("gives the invite code to the owner and to an admin", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      conversationPage = [
        pageConversation("den-1", "DEN", ["user1", "user2"], {
          messageConversationMembers: [
            memberRow("den-1", "user1", { role }),
            memberRow("den-1", "user2"),
          ],
        }),
      ];
      const body = await readList();
      expect(body.items[0]?.conversation.inviteCode).toBe("abcdefghjkmn");
    }
  });

  test("leaves a DM's payload untouched", async () => {
    // A DM carries no code at all, so the redaction cannot change one - asserted
    // so a future "strip the den columns from a DM" tidy-up cannot hide inside
    // this change.
    conversationPage = [
      pageConversation("dm-1", "DM", ["user1", "user2"], {
        inviteCode: null,
        messageConversationMembers: [
          memberRow("dm-1", "user1", { role: "MEMBER" }),
          memberRow("dm-2", "user2"),
        ],
      }),
    ];
    const body = await readList();
    expect(body.items[0]?.conversation.inviteCode).toBeNull();
    expect(body.items[0]?.conversation.type).toBe("DM");
    expect(body.items).toHaveLength(1);
  });

  test("reports the roster counter, which names nobody", async () => {
    // The client compares this against the newest counter the server has reported
    // to it, and refetches when it is ahead: that is how a lost membership
    // announcement is caught. A mapper that dropped it would leave the guard with
    // nothing to compare, so it is asserted here rather than trusted - and it is
    // carried through even for a plain member, because a count of roster changes
    // they may have missed discloses nothing about who is in the room.
    conversationPage = [
      pageConversation("den-1", "DEN", ["user1", "user2"], {
        membershipSeq: 12,
        messageConversationMembers: [
          memberRow("den-1", "user1"),
          memberRow("den-1", "user2"),
        ],
      }),
    ];
    const body = await readList();
    expect(body.items[0]?.conversation.membershipSeq).toBe(12);
    expect(body.conversations[0]?.membershipSeq).toBe(12);
    // A DM carries 0 rather than nothing: its roster never moves, and an absent
    // value would be indistinguishable from a payload that predates the column.
    conversationPage = [
      pageConversation("dm-1", "DM", ["user1", "user2"], { membershipSeq: 0 }),
    ];
    const dm = await readList();
    expect(dm.items[0]?.conversation.membershipSeq).toBe(0);
  });

  test("withholds the code from a member who is not even on the roster", async () => {
    // Defence in depth: the mapper falls back to "cannot manage" when it cannot
    // find the viewer, so a row that somehow reaches it without a membership
    // answers nothing rather than everything.
    conversationPage = [
      pageConversation("den-1", "DEN", ["user2"], {
        messageConversationMembers: [memberRow("den-1", "user2")],
      }),
    ];
    const body = await readList();
    expect(body.items[0]?.conversation.inviteCode).toBeNull();
  });
});

describe("POST /api/messages/conversations rate limit", () => {
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
    limiter.reset();
  });

  test("a DM spends the DM budget, per account", async () => {
    const res = await postWith("user2");
    expect(res.status).toBe(201);
    expect(limiter.chargedBuckets).toEqual([DEN_DM_CREATE_RATE_LIMIT.bucket]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("429s with a retry-after and writes no conversation when over budget", async () => {
    // The gap this closes: the den half of this route has been metered since it
    // was written and the DM half was not. Every accepted DM lands in somebody
    // else's conversation list, which is the unsolicited-DM spam the platforms
    // answer with a limit rather than with a block.
    limiter.setDenied(true);
    const res = await postWith("user2");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFindUniqueUser).not.toHaveBeenCalled();
  });

  test("charges the limiter before it looks the recipient up", async () => {
    const res = await postWith("user2");
    expect(res.status).toBe(201);
    expect(limiter.order[0]).toBe(`consume:${DEN_DM_CREATE_RATE_LIMIT.bucket}`);
    expect(limiter.order).toContain("service:create-conversation");
  });

  test("a den create does not spend the DM budget, or the DM one the den budget", async () => {
    // Two shapes on one route, and the only reason a shared bucket would be
    // wrong is that a person legitimately opening DMs all afternoon would spend
    // the budget a den create needs, and a script creating one den an hour would
    // spend a DM's.
    const req = new Request(
      "http://localhost/3000/api/messages/conversations",
      {
        body: JSON.stringify({
          memberIds: ["user2"],
          name: "Room",
          type: "DEN",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    );
    // This file's Prisma double does not carry the follow-graph reads
    // `validateDenRoster` needs, so the den branch throws past them. What is
    // under test is only which budget it charged on the way, so the rejection is
    // caught rather than papered over.
    await POST(req).catch(() => {});
    expect(limiter.chargedBuckets).toEqual([DEN_CREATE_RATE_LIMIT.bucket]);
    expect(DEN_CREATE_RATE_LIMIT.bucket).not.toBe(
      DEN_DM_CREATE_RATE_LIMIT.bucket
    );
  });

  test("the list read is not metered by either create budget", async () => {
    // The inbox re-reads on every message-created activity event, so any budget
    // tight enough to stop a loop throttles normal use. The audit test's
    // allowlist records that decision; this is the behavioural half of it.
    const res = await GET(
      new Request("http://localhost/api/messages/conversations")
    );
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([]);
  });
});

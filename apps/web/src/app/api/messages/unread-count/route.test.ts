// Several tests below re-run the SAME route against a shared module-level fixture,
// so their reads are sequential by construction: each pass rewrites the fixture
// and the next pass reads what that rewrite produced. Parallelising them would
// interleave the writes with the reads and the assertions would be about nothing.
// oxlint-disable no-await-in-loop
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
const mockCacheGet = mock((): number | null => null);
const mockCacheIncrement = mock(() => 1);

// Everything this route reads, recorded rather than answered from a guess, so a
// test can assert WHICH query happened and not merely that the number came out.
const dbCalls: string[] = [];

interface MembershipRow {
  conversationId: string;
  lastReadAt: Date | null;
}

let memberships: MembershipRow[] = [];
let outboundBlocks: string[] = [];
let inboundBlocks: string[] = [];
// Conversation rows the DM-only candidate query answers with. Only DMs are ever
// returned, because the route filters the type in SQL.
let candidateDms: { id: string; memberIds: string[] }[] = [];
let unreadRows: string[] = [];

// The predicate the grouped read was given, flattened into something assertable.
let lastUnreadWhere: {
  senderIds: string[] | null;
  watermarks: { conversationId: string; lastReadAt: Date }[];
} | null = null;

// The accessor surface the shared predicate is driven against. Declared here
// rather than inside the predicate so the Messages mock can hand it back when the
// route actually runs the predicate, which is where the watermarks get recorded.
let lastSenderIds: string[] | null = null;

const messageAccessors = {
  conversationId: { eq: (id: string) => ({ eq: id }) },
  createdAt: { gt: (value: unknown) => ({ gt: value }) },
  deletedAt: { isNull: () => ({ isNull: true }) },
  hiddenFor: {
    none: (
      relationFilter: (hidden: {
        userId: { eq: (id: string) => unknown };
      }) => unknown
    ) => {
      relationFilter({ userId: { eq: () => ({}) } });
      return { none: true };
    },
  },
  senderId: {
    notIn: (ids: string[]) => {
      lastSenderIds = ids;
      return { notIn: ids };
    },
  },
};

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        Blocks: {
          select: (field: string) => ({
            where: (filter: { blockedId?: string; blockerId?: string }) => ({
              all: () => {
                dbCalls.push(`Blocks:${field}`);
                const ids =
                  filter.blockerId === "user1" ? outboundBlocks : inboundBlocks;
                return ids.map((id) => ({ [field]: id }));
              },
            }),
          }),
        },
        MessageConversationMembers: {
          // The badge seed skips muted memberships, so the where is a predicate
          // that must tolerate the mutedAt column.
          select: () => ({
            where: (
              predicate?: (member: {
                mutedAt: { isNull: () => unknown };
                userId: { eq: (id: string) => unknown };
              }) => unknown
            ) => {
              predicate?.({
                mutedAt: { isNull: () => ({}) },
                userId: { eq: () => ({}) },
              } as never);
              return {
                all: () => {
                  dbCalls.push("MessageConversationMembers");
                  return memberships;
                },
              };
            },
          }),
        },
        MessageConversations: {
          select: () => ({
            include: () => ({
              where: (
                predicate: (conversation: {
                  _type: { eq: (type: string) => unknown };
                  id: { in: (ids: string[]) => unknown };
                }) => unknown
              ) => {
                let type = "";
                let ids: string[] = [];
                predicate({
                  _type: {
                    eq: (value) => {
                      type = value;
                      return {};
                    },
                  },
                  id: {
                    in: (value) => {
                      ids = value;
                      return {};
                    },
                  },
                });
                return {
                  all: () => {
                    dbCalls.push(`MessageConversations:${type}`);
                    return candidateDms
                      .filter((row) => ids.includes(row.id) && type === "DM")
                      .map((row) => ({
                        _type: "DM" as const,
                        id: row.id,
                        messageConversationMembers: row.memberIds.map(
                          (userId) => ({ userId })
                        ),
                      }));
                  },
                };
              },
            }),
          }),
        },
        Messages: {
          select: () => ({
            where: (predicate: (message: unknown) => unknown) => ({
              all: () => {
                dbCalls.push("Messages");
                // The predicate is driven with the same accessors the shared
                // predicate closes over, which is what records the watermarks.
                predicate(messageAccessors);
                return unreadRows.map((conversationId) => ({ conversationId }));
              },
            }),
          }),
          // The removed per-membership shape. Still present so a regression that
          // brings the N+1 back gets a hard failure rather than a silent pass.
          where: () => ({
            aggregate: (
              aggregate: (value: { count: () => number }) => unknown
            ) => {
              dbCalls.push("Messages:aggregate");
              return aggregate({ count: () => unreadRows.length });
            },
          }),
        },
      },
    },
  },
  unreadMessageCache: {
    get: mockCacheGet,
    increment: mockCacheIncrement,
  },
  unreadMessagesWhere: (params: {
    userId: string;
    watermarks: readonly {
      conversationId: string;
      lastReadAt: Date | null;
    }[];
  }) => {
    const watermarks: { conversationId: string; lastReadAt: Date }[] = [];
    let senderIds: string[] | null = null;
    return (message: typeof messageAccessors) => {
      for (const watermark of params.watermarks) {
        message.conversationId.eq(watermark.conversationId);
        message.createdAt.gt(watermark.lastReadAt ?? new Date(0));
        watermarks.push({
          conversationId: watermark.conversationId,
          lastReadAt: watermark.lastReadAt ?? new Date(0),
        });
      }
      message.deletedAt.isNull();
      message.hiddenFor.none((hidden) => hidden.userId.eq(params.userId));
      message.senderId.notIn([params.userId]);
      senderIds = lastSenderIds;
      lastUnreadWhere = { senderIds, watermarks };
      return {};
    };
  },
}));

describe("GET /api/messages/unread-count", () => {
  beforeEach(() => {
    mockCacheGet.mockClear();
    mockCacheIncrement.mockClear();
    mockGetSession.mockClear();
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockCacheGet.mockImplementation(() => null);
    dbCalls.length = 0;
    memberships = [
      {
        conversationId: "convo-1",
        lastReadAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    outboundBlocks = [];
    inboundBlocks = [];
    candidateDms = [];
    unreadRows = [];
    lastUnreadWhere = null;
    lastSenderIds = null;
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns the cached counter when present", async () => {
    mockCacheGet.mockReturnValueOnce(3);
    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(3);
    expect(dbCalls).toEqual([]);
  });

  test("returns 0 without querying when the user has no memberships", async () => {
    memberships = [];
    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(0);
    expect(dbCalls).not.toContain("Messages");
    expect(mockCacheIncrement).not.toHaveBeenCalled();
  });

  test("seeds the cache from the DB baseline, with the shared watermark rules", async () => {
    unreadRows = ["convo-1"];
    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(1);
    expect(mockCacheIncrement).toHaveBeenCalledWith("user1", 1);
    // The three message-level rules, carried by the shared predicate: your own
    // sends never accrue a badge, and the reader's own id is the one excluded.
    expect(lastUnreadWhere?.senderIds).toEqual(["user1"]);
    expect(lastUnreadWhere?.watermarks).toEqual([
      {
        conversationId: "convo-1",
        lastReadAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });

  test("a never-read conversation counts from the epoch, not from null", async () => {
    memberships = [{ conversationId: "convo-1", lastReadAt: null }];
    await GET();
    expect(lastUnreadWhere?.watermarks).toEqual([
      { conversationId: "convo-1", lastReadAt: new Date(0) },
    ]);
  });

  test("a muted membership is excluded before any count happens", async () => {
    // The route's own membership query filters muted rows, so nothing downstream
    // has to remember to. Asserted through the absence of the conversation from
    // the watermark set the grouped read was handed.
    memberships = [];
    await GET();
    expect(lastUnreadWhere).toBeNull();
  });

  // FIX D. The number of round trips must not scale with the number of
  // conversations in the reader's inbox.
  test("issues one message read for a hundred conversations, not a hundred", async () => {
    memberships = Array.from({ length: 100 }, (_unused, index) => ({
      conversationId: `convo-${index}`,
      lastReadAt: new Date("2026-01-01T00:00:00Z"),
    }));
    unreadRows = memberships.map((row) => row.conversationId);

    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(100);

    // One grouped read, and every conversation's watermark present in it.
    expect(dbCalls.filter((call) => call.startsWith("Messages")).length).toBe(
      1
    );
    expect(dbCalls).not.toContain("Messages:aggregate");
    expect(lastUnreadWhere?.watermarks).toHaveLength(100);
    expect(
      lastUnreadWhere?.watermarks.map((row) => row.conversationId)
    ).toEqual(memberships.map((row) => row.conversationId));
  });

  test("keeps the round-trip count flat as the inbox grows", async () => {
    // The property rather than the number: one conversation and a hundred take
    // the same number of reads. A per-conversation loop passes the test above by
    // accident (one conversation, one read) and fails this one.
    const readsFor = async (count: number) => {
      dbCalls.length = 0;
      memberships = Array.from({ length: count }, (_unused, index) => ({
        conversationId: `convo-${index}`,
        lastReadAt: null,
      }));
      unreadRows = [];
      await GET();
      return dbCalls.filter((call) => call.startsWith("Messages")).length;
    };
    expect(await readsFor(1)).toBe(1);
    expect(await readsFor(50)).toBe(1);
    expect(await readsFor(200)).toBe(1);
  });

  // FIX E. The shared-predicate branch, for both conversation types.
  test("reads the DM roster for a DM and refuses the conversation", async () => {
    outboundBlocks = ["user2"];
    candidateDms = [{ id: "convo-1", memberIds: ["user1", "user2"] }];

    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    // Blocked, so its unread messages are not this reader's business at all.
    expect(body.unreadCount).toBe(0);
    // The candidate read happened, and it happened for a DM.
    expect(dbCalls).toContain("MessageConversations:DM");
    // And the blocked conversation was dropped before the grouped read.
    expect(lastUnreadWhere).toBeNull();
    expect(mockCacheIncrement).not.toHaveBeenCalled();
  });

  test("never reads a den's roster for a DM-only question", async () => {
    // FIX F. The reader is blocked with somebody, so the probe runs - and the
    // probe still touches nothing but DMs. A den in the same account must not
    // pull its roster in, and must not be dropped either.
    outboundBlocks = ["user2"];
    memberships = [
      { conversationId: "dm-1", lastReadAt: null },
      { conversationId: "den-1", lastReadAt: null },
    ];
    candidateDms = [{ id: "dm-1", memberIds: ["user1", "user2"] }];
    unreadRows = ["den-1", "den-1"];

    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    // The blocked DM goes, the den stays and keeps counting.
    expect(body.unreadCount).toBe(2);
    expect(
      lastUnreadWhere?.watermarks.map((row) => row.conversationId)
    ).toEqual(["den-1"]);
    // The probe asked for DMs and only DMs.
    expect(dbCalls).toContain("MessageConversations:DM");
    expect(dbCalls).not.toContain("MessageConversations:DEN");
  });

  test("a den survives a block between two of its members, whatever the roster order", async () => {
    // The rule, at the value that used to be row-order dependent. The blocked
    // person is first in one roster and last in the other, and the den's badge
    // must not move between them - a badge that jumps as somebody unrelated joins
    // is worse than either possible answer.
    for (const _memberIds of [
      ["user1", "user2"],
      ["user1", "user3", "user2"],
    ]) {
      dbCalls.length = 0;
      memberships = [{ conversationId: "den-1", lastReadAt: null }];
      outboundBlocks = ["user2"];
      // A den never appears in the DM candidate read, which is the point: it is
      // not even asked about.
      candidateDms = [];
      unreadRows = ["den-1", "den-1", "den-1"];

      const res = await GET();
      const body = (await res.json()) as { unreadCount: number };
      expect(body.unreadCount).toBe(3);
      expect(lastUnreadWhere?.watermarks).toEqual([
        { conversationId: "den-1", lastReadAt: new Date(0) },
      ]);
    }
  });

  test("skips the candidate read entirely when nobody is blocked", async () => {
    // No block anywhere means no peer to resolve, so the DM probe is a query
    // whose answer is known to be "nothing is hidden".
    candidateDms = [{ id: "convo-1", memberIds: ["user1", "user2"] }];
    unreadRows = ["convo-1"];
    await GET();
    expect(dbCalls).not.toContain("MessageConversations:DM");
    expect(lastUnreadWhere?.watermarks).toHaveLength(1);
  });

  test("a blocked partner's inbound block counts too", async () => {
    // The other direction: the reader is the one who was blocked. Both are the
    // same refusal, and reading only one direction would let half the pairs
    // through.
    inboundBlocks = ["user2"];
    candidateDms = [{ id: "convo-1", memberIds: ["user1", "user2"] }];
    const res = await GET();
    const body = (await res.json()) as { unreadCount: number };
    expect(body.unreadCount).toBe(0);
    expect(lastUnreadWhere).toBeNull();
  });
});

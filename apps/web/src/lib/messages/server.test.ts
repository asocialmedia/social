import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { isHiddenByBlock } from "./blocks";
import {
  getConversationForUser,
  isBlockedFromConversation,
  nextRatchetIndex,
} from "./server";

const mockKeyFindFirst = mock(() => null);
const mockMessageCount = mock(() => 0);
// The conversation row getConversationForUser loads. Defaults to a DM between
// two members so the pre-existing block behaviour is what the tests below
// measure, and the den cases opt in explicitly.
// The member rows the conversation query returns. `user` is present because the
// mapper dereferences it: a member row without one is a broken query result, and
// the mapper's throw is the correct response to that, not a thing to mock away.
function memberRow(userId: string, role: "ADMIN" | "MEMBER" | "OWNER") {
  return {
    lastReadAt: null,
    mutedAt: null,
    role,
    user: { messageIdentities: null },
    userId,
  };
}

function conversationRow(
  overrides: {
    inviteCode?: string | null;
    members?: ReturnType<typeof memberRow>[];
    membershipSeq?: number;
    name?: string | null;
    pairKey?: string | null;
  } = {}
) {
  return {
    _type: "DM" as "DM" | "DEN",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: "convo-1",
    inviteCode: overrides.inviteCode ?? null,
    membershipSeq: overrides.membershipSeq ?? 3,
    messageConversationKeys: [],
    messageConversationMembers: overrides.members ?? [
      memberRow("user-1", "MEMBER"),
      memberRow("user-2", "MEMBER"),
    ],
    name: overrides.name ?? null,
    // A den's pairKey is null, which `??` would replace with the DM default, so
    // the presence of the key is checked rather than its truthiness.
    pairKey:
      "pairKey" in overrides ? (overrides.pairKey ?? null) : "user-1:user-2",
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

const mockConversationRow = mock(conversationRow);
const mockBlockFindFirst = mock(() => null);
// Records the predicate the key query was ordered by, so the test can assert the
// newest epoch is the one that governs new sends.
const orderByCalls: ((accessor: {
  version: { desc: () => unknown };
}) => unknown)[] = [];

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  and: (...conditions: unknown[]) =>
    conditions.filter((condition) => condition !== undefined),
  fromPrismaDateTime: (value: Date) => value,
  getUserDataQuery: () => ({ include: () => ({}) }),
  mapUserData: (user: unknown) => user,
  prisma: {
    orm: {
      public: {
        Blocks: {
          select: () => ({ where: () => ({ first: mockBlockFindFirst }) }),
        },
        MessageConversationKeys: {
          select: () => ({
            orderBy: (predicate: (accessor: never) => unknown) => {
              orderByCalls.push(predicate as never);
              return { first: mockKeyFindFirst };
            },
            where: () => ({
              first: mockKeyFindFirst,
              orderBy: (predicate: (accessor: never) => unknown) => {
                orderByCalls.push(predicate as never);
                return { first: mockKeyFindFirst };
              },
            }),
          }),
        },
        MessageConversations: {
          // The real builder chains .select().include().include().where().first(),
          // so the mock has to be chainable rather than a fixed object: a stub
          // that only answers the last call in the chain would silently pass
          // while the query it stands in for never ran.
          select: () => {
            const builder = {
              first: () => mockConversationRow(),
              include: () => builder,
              where: () => builder,
            };
            return builder;
          },
        },
        Messages: {
          where: () => ({
            aggregate: (
              aggregate: (value: { count: () => number }) => unknown
            ) => aggregate({ count: mockMessageCount }),
          }),
        },
      },
    },
  },
  toPrismaDateTime: (value: Date) => value,
}));

describe("nextRatchetIndex", () => {
  beforeEach(() => {
    mockKeyFindFirst.mockClear();
    mockMessageCount.mockClear();
    orderByCalls.length = 0;
  });

  test("uses the atomic counter when it is ahead of the count", async () => {
    // A fresh thread where the counter tracks sends exactly.
    mockKeyFindFirst.mockReturnValueOnce({ ratchetCounter: 5 });
    mockMessageCount.mockReturnValueOnce(5);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(5);
  });

  test("reads the newest epoch's counter when several wraps exist", async () => {
    // An identity reset appended a v2 wrap; the counter that governs new sends
    // must come from the newest epoch, not an older row.
    mockKeyFindFirst.mockReturnValueOnce({ ratchetCounter: 12 });
    mockMessageCount.mockReturnValueOnce(10);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(12);
    expect(orderByCalls).toHaveLength(1);
    // The ordering must be on version descending.
    expect(orderByCalls[0]?.({ version: { desc: () => "version:desc" } })).toBe(
      "version:desc"
    );
  });

  test("uses the message count when the counter lags legacy rows", async () => {
    // The exact regression: messages existed before the counter column, so the
    // counter is 0 while 10 messages are already on the chain. The next index
    // must be 10, not 0, or every send would 409.
    mockKeyFindFirst.mockReturnValueOnce({ ratchetCounter: 0 });
    mockMessageCount.mockReturnValueOnce(10);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(10);
  });

  test("falls back to 0 when there is no key row and no messages", async () => {
    mockKeyFindFirst.mockReturnValueOnce(null);
    mockMessageCount.mockReturnValueOnce(0);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(0);
  });

  test("returns the max even when the counter overshoots", async () => {
    mockKeyFindFirst.mockReturnValueOnce({ ratchetCounter: 12 });
    mockMessageCount.mockReturnValueOnce(10);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(12);
  });
});

describe("getConversationForUser", () => {
  beforeEach(() => {
    mockConversationRow.mockClear();
    mockBlockFindFirst.mockClear();
    mockConversationRow.mockImplementation(() => conversationRow());
    mockBlockFindFirst.mockImplementation(() => null);
  });

  test("returns null to a non-member", async () => {
    expect(await getConversationForUser("convo-1", "stranger")).toBeNull();
    // No block probe may run for someone who is not in the conversation: it
    // would leak the pair's existence through a timing-visible query.
    expect(mockBlockFindFirst).not.toHaveBeenCalled();
  });

  test("exposes the den type as `type`, never as the contract's `_type`", async () => {
    // The underscore is a PSL keyword workaround. A client that has to know
    // about it is a bug, and shipping both names is worse: two sources of truth
    // for the same column.
    const conversation = await getConversationForUser("convo-1", "user-1");
    expect(conversation?.type).toBe("DM");
    expect("_type" in (conversation ?? {})).toBe(false);
  });

  test("carries the roster counter through to the detail payload", async () => {
    // The detail read is the client's main answer to "has my roster moved?", so
    // the counter has to be in this payload and not only in the list one: the
    // list is refetched on a timer, the detail is refetched because something said
    // to. It names nobody, so it rides the same gate as everything else here.
    const conversation = await getConversationForUser("convo-1", "user-1");
    expect(conversation?.membershipSeq).toBe(3);
    mockConversationRow.mockImplementation(() =>
      conversationRow({ membershipSeq: 11 })
    );
    const afterSecondRead = await getConversationForUser("convo-1", "user-1");
    expect(afterSecondRead?.membershipSeq).toBe(11);
  });

  test("hides a blocked pair in a DM", async () => {
    mockBlockFindFirst.mockImplementation(() => ({ blockerId: "user-2" }));
    expect(await getConversationForUser("convo-1", "user-1")).toBeNull();
  });

  test("the send path can skip the block gate and report its own 403", async () => {
    mockBlockFindFirst.mockImplementation(() => ({ blockerId: "user-2" }));
    const conversation = await getConversationForUser("convo-1", "user-1", {
      enforceBlocks: false,
    });
    expect(conversation?.id).toBe("convo-1");
    expect(mockBlockFindFirst).not.toHaveBeenCalled();
  });

  test("does not hide a den member over a block on somebody else in it", async () => {
    // The regression this guards: applying the pair rule to a den would let one
    // member's block revoke every other member's access to the group.
    mockConversationRow.mockImplementation(() => ({
      ...conversationRow({
        inviteCode: "abc",
        members: [memberRow("user-1", "OWNER"), memberRow("user-2", "MEMBER")],
        name: "Den",
        pairKey: null,
      }),
      _type: "DEN" as const,
    }));
    mockBlockFindFirst.mockImplementation(() => ({ blockerId: "user-2" }));
    const conversation = await getConversationForUser("convo-1", "user-1");
    expect(conversation?.type).toBe("DEN");
    // The pair probe never runs at all, so a block cannot reach the gate.
    expect(mockBlockFindFirst).not.toHaveBeenCalled();
  });

  test("carries each member's den role through", async () => {
    mockConversationRow.mockImplementation(() => ({
      ...conversationRow({
        inviteCode: "abc",
        members: [memberRow("user-1", "OWNER"), memberRow("user-2", "ADMIN")],
        name: "Den",
        pairKey: null,
      }),
      _type: "DEN" as const,
    }));
    const conversation = await getConversationForUser("convo-1", "user-1");
    expect(conversation?.members.map((member) => member.role)).toEqual([
      "OWNER",
      "ADMIN",
    ]);
  });

  test("carries the den columns so a client needs no second fetch", async () => {
    mockConversationRow.mockImplementation(() => ({
      ...conversationRow({
        inviteCode: "abc",
        members: [memberRow("user-1", "OWNER")],
        name: "Game night",
        pairKey: null,
      }),
      _type: "DEN" as const,
    }));
    const conversation = await getConversationForUser("convo-1", "user-1");
    expect(conversation?.name).toBe("Game night");
    expect(conversation?.inviteCode).toBe("abc");
    expect(conversation?.pairKey).toBeNull();
  });

  test("the block predicate is the one the list route shares", () => {
    // Exported so the conversation list filters with the same rule the detail
    // gate applies. If the two ever drift, a blocked pair gets a conversation
    // it cannot open, or a den disappears from the rail for the wrong reason.
    expect(isHiddenByBlock("DM", "b", true)).toBe(true);
    expect(isHiddenByBlock("DM", "b", false)).toBe(false);
    expect(isHiddenByBlock("DEN", "b", true)).toBe(false);
    // No peer resolved yet: nothing to be blocked from, so nothing is hidden.
    expect(isHiddenByBlock("DM", undefined, false)).toBe(false);
  });

  test("never probes blocks for a den, however many members it has", async () => {
    // Not just "ignores the answer": the query must not run. On a den read that
    // is a wasted round trip on the hottest path in the app, and on a large den
    // it is the difference between one lookup and a scan for a peer that does
    // not exist.
    mockConversationRow.mockImplementation(() => ({
      ...conversationRow({
        inviteCode: "abc",
        members: [
          memberRow("user-1", "OWNER"),
          memberRow("user-2", "MEMBER"),
          memberRow("user-3", "MEMBER"),
        ],
        name: "Den",
        pairKey: null,
      }),
      _type: "DEN" as const,
    }));
    expect(await getConversationForUser("convo-1", "user-1")).not.toBeNull();
    expect(mockBlockFindFirst).not.toHaveBeenCalled();
  });

  test("a DM with no resolvable peer is not treated as blocked", async () => {
    // A DM row whose peer has been removed is a half-state the gate must not
    // resolve into "blocked", or the survivor loses their own history.
    mockConversationRow.mockImplementation(() => ({
      ...conversationRow({ members: [memberRow("user-1", "MEMBER")] }),
    }));
    expect(
      await isBlockedFromConversation(
        { members: [{ userId: "user-1" }], type: "DM" },
        "user-1"
      )
    ).toBe(false);
    expect(mockBlockFindFirst).not.toHaveBeenCalled();
  });
});

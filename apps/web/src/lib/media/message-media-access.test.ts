import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { isMessageMediaViewer } from "./message-media-access";

const mockFindUnique = mock((userId: string) =>
  userId === "member-1" ? { conversationId: "convo-1", userId } : null
);
const mockFindFirst = mock(() => ({ userId: "member-2" }));
const mockAreBlocked = mock(() => false);
// "DM" by default so the existing block gate runs. A test flips this to "DEN"
// to prove the gate is pair-only and does not deny a member over somebody
// else's block.
const mockConversationType = mock(() => ({ _type: "DM" as "DM" | "DEN" }));
const store = new Map<string, string>();
const mockRedisGet = mock((key: string) =>
  Promise.resolve(store.has(key) ? (store.get(key) as string) : null)
);
const mockRedisSet = mock((key: string, value: string) => {
  store.set(key, value);
  return Promise.resolve("OK");
});

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          select: () => ({
            where: (
              predicate: (candidate: {
                conversationId: { eq: (id: string) => unknown };
                userId: {
                  eq: (id: string) => unknown;
                  notIn: (ids: string[]) => unknown;
                };
              }) => unknown
            ) => {
              let viewerId = "";
              let peerLookup = false;
              predicate({
                conversationId: { eq: () => ({}) },
                userId: {
                  eq: (id) => {
                    viewerId = id;
                    return {};
                  },
                  notIn: () => {
                    peerLookup = true;
                    return {};
                  },
                },
              });
              return {
                first: () =>
                  peerLookup ? mockFindFirst() : mockFindUnique(viewerId),
              };
            },
          }),
        },
        MessageConversations: {
          select: () => ({
            where: () => ({ first: () => mockConversationType() }),
          }),
        },
      },
    },
  },
  redis: {
    ...asmDbMockBase.redis,
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

mock.module("@/lib/messages/server", () => ({
  areBlocked: mockAreBlocked,
}));

describe("isMessageMediaViewer", () => {
  beforeEach(() => {
    store.clear();
    mockFindUnique.mockClear();
    mockAreBlocked.mockClear();
    mockConversationType.mockClear();
    // mockClear only clears calls, not implementations, so the shared defaults
    // are restated here. A test that pins one of these must do it with
    // mockImplementationOnce, or it leaks into every test after it.
    mockAreBlocked.mockImplementation(() => false);
    mockConversationType.mockImplementation(() => ({ _type: "DM" }));
  });

  test("admits conversation members", async () => {
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(true);
  });

  test("denies non-members without leaking (false, not throw)", async () => {
    expect(await isMessageMediaViewer("convo-1", "stranger")).toBe(false);
  });

  test("denies blocked members like the message read gate", async () => {
    mockAreBlocked.mockImplementationOnce(() => true);
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(false);
  });

  test("does not consult the block in a den", async () => {
    // A den has no single peer. Running the peer probe there would find an
    // arbitrary member and deny this viewer their own media because of somebody
    // else's block, so the gate must short-circuit on the conversation type.
    //
    // areBlocked is pinned to true for the whole test, not once: an unconsumed
    // mockImplementationOnce would carry into the next test and deny a member
    // who is not blocked at all.
    mockConversationType.mockImplementation(() => ({ _type: "DEN" }));
    mockAreBlocked.mockImplementation(() => true);
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(true);
    expect(mockAreBlocked).not.toHaveBeenCalled();
  });

  test("admits a member whose conversation type row is missing", async () => {
    // Fail open to membership rather than to a throw: the type lookup only
    // decides whether the pair block gate runs, and losing it must not cost a
    // real member access to their own attachment.
    mockConversationType.mockImplementation(() => null);
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(true);
  });

  test("caches the decision so the hot path skips the database", async () => {
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(true);
    const callsAfterFirst = mockFindUnique.mock.calls.length;
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(true);
    expect(mockFindUnique.mock.calls.length).toBe(callsAfterFirst);
  });
});

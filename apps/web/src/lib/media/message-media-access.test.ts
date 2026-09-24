import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { isMessageMediaViewer } from "./message-media-access";

const mockFindUnique = mock((userId: string) =>
  userId === "member-1" ? { conversationId: "convo-1", userId } : null
);
const mockFindFirst = mock(() => ({ userId: "member-2" }));
const mockAreBlocked = mock(() => false);
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

  test("caches the decision so the hot path skips the database", async () => {
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(true);
    const callsAfterFirst = mockFindUnique.mock.calls.length;
    expect(await isMessageMediaViewer("convo-1", "member-1")).toBe(true);
    expect(mockFindUnique.mock.calls.length).toBe(callsAfterFirst);
  });
});

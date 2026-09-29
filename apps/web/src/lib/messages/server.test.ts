import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { nextRatchetIndex } from "./server";

const mockKeyFindFirst = mock(() => null);
const mockMessageCount = mock(() => 0);
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
  prisma: {
    orm: {
      public: {
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

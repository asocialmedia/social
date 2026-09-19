import { beforeEach, describe, expect, mock, test } from "bun:test";

import { nextRatchetIndex } from "./server";

const mockKeyFindFirst = mock(() => null);
const mockMessageCount = mock(() => 0);

mock.module("@asm/db", () => ({
  prisma: {
    message: { count: mockMessageCount },
    messageConversationKey: { findFirst: mockKeyFindFirst },
  },
}));

describe("nextRatchetIndex", () => {
  beforeEach(() => {
    mockKeyFindFirst.mockClear();
    mockMessageCount.mockClear();
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
    const args = mockKeyFindFirst.mock.calls[0]?.[0] as {
      orderBy: { version: string };
      where: { conversationId: string; ownerUserId: string };
    };
    expect(args.orderBy).toEqual({ version: "desc" });
    expect(args.where).toEqual({
      conversationId: "convo-1",
      ownerUserId: "user-1",
    });
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

import { beforeEach, describe, expect, mock, test } from "bun:test";

import { nextRatchetIndex } from "./server";

const mockKeyFindUnique = mock(() => null);
const mockMessageCount = mock(() => 0);

mock.module("@asm/db", () => ({
  prisma: {
    message: { count: mockMessageCount },
    messageConversationKey: { findUnique: mockKeyFindUnique },
  },
}));

describe("nextRatchetIndex", () => {
  beforeEach(() => {
    mockKeyFindUnique.mockClear();
    mockMessageCount.mockClear();
  });

  test("uses the atomic counter when it is ahead of the count", async () => {
    // A fresh thread where the counter tracks sends exactly.
    mockKeyFindUnique.mockReturnValueOnce({ ratchetCounter: 5 });
    mockMessageCount.mockReturnValueOnce(5);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(5);
  });

  test("uses the message count when the counter lags legacy rows", async () => {
    // The exact regression: messages existed before the counter column, so the
    // counter is 0 while 10 messages are already on the chain. The next index
    // must be 10, not 0, or every send would 409.
    mockKeyFindUnique.mockReturnValueOnce({ ratchetCounter: 0 });
    mockMessageCount.mockReturnValueOnce(10);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(10);
  });

  test("falls back to 0 when there is no key row and no messages", async () => {
    mockKeyFindUnique.mockReturnValueOnce(null);
    mockMessageCount.mockReturnValueOnce(0);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(0);
  });

  test("returns the max even when the counter overshoots", async () => {
    mockKeyFindUnique.mockReturnValueOnce({ ratchetCounter: 12 });
    mockMessageCount.mockReturnValueOnce(10);
    expect(await nextRatchetIndex("convo-1", "user-1")).toBe(12);
  });
});

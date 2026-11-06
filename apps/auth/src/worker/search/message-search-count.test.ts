import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { MessageSearchWorkerMetricEvent } from "./message-search-metrics";

const request = {
  attempts: 1,
  conversationId: "conversation-1",
  createdAt: new Date(Date.now() - 5000),
  expiresAt: new Date("2026-10-08T10:00:00.000Z"),
  fragments: [{ grams: ["3:nee"], text: "needle" }],
  id: "count-request-1",
  membershipSequence: 0,
  membershipWindows: [{ after: null, before: null }],
  normalizationVersion: 1,
  queryHash: "query-hash",
  recoveryGeneration: 1,
  snapshotSequence: 12,
  userId: "user-1",
};
const mockClaim = mock((): Promise<typeof request | null> =>
  Promise.resolve(request)
);
const mockComplete = mock(() => Promise.resolve());
const mockCount = mock(() => Promise.resolve(17));
const mockRelease = mock(() => Promise.resolve());
const mockError = mock();

mock.module("@asm/db", () => ({
  claimMessageSearchCountRequest: mockClaim,
  completeMessageSearchCountRequest: mockComplete,
  countMessageSearchCandidates: mockCount,
  releaseMessageSearchCountRequest: mockRelease,
}));

describe("message search count worker", () => {
  beforeEach(() => {
    mockClaim.mockReset();
    mockClaim.mockReturnValue(Promise.resolve(request));
    mockComplete.mockReset();
    mockComplete.mockReturnValue(Promise.resolve());
    mockCount.mockReset();
    mockCount.mockReturnValue(Promise.resolve(17));
    mockRelease.mockReset();
    mockRelease.mockReturnValue(Promise.resolve());
    mockError.mockReset();
  });

  test("claims a scoped request and commits its exact count", async () => {
    const { processMessageSearchCount } =
      await import("./message-search-count");
    const metrics: MessageSearchWorkerMetricEvent[] = [];
    await processMessageSearchCount(
      "count-request-1",
      {
        error: mockError,
      },
      { record: (event) => metrics.push(event) }
    );

    expect(mockClaim).toHaveBeenCalledWith("count-request-1");
    expect(mockCount).toHaveBeenCalledWith({
      conversationId: request.conversationId,
      fragments: request.fragments,
      membershipWindows: request.membershipWindows,
      snapshotSequence: request.snapshotSequence,
      userId: request.userId,
    });
    expect(mockComplete).toHaveBeenCalledWith(request.id, 17);
    expect(mockRelease).not.toHaveBeenCalled();
    expect(metrics).toEqual([
      expect.objectContaining({
        job: "count",
        outcome: "completed",
        queueAgeMs: expect.any(Number),
      }),
    ]);
  });

  test("does no work for a stale or already completed queue delivery", async () => {
    mockClaim.mockReturnValueOnce(Promise.resolve(null));
    const { processMessageSearchCount } =
      await import("./message-search-count");
    await processMessageSearchCount("count-request-1", {
      error: mockError,
    });
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test("releases durable work for BullMQ retry after a count failure", async () => {
    const failure = new Error("temporary database failure");
    mockCount.mockRejectedValueOnce(failure);
    const { processMessageSearchCount } =
      await import("./message-search-count");
    const metrics: MessageSearchWorkerMetricEvent[] = [];
    await expect(
      processMessageSearchCount(
        "count-request-1",
        { error: mockError },
        { record: (event) => metrics.push(event) }
      )
    ).rejects.toBe(failure);
    expect(mockRelease).toHaveBeenCalledWith(request.id);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith(
      { requestId: "count-request-1" },
      "DM search count processing failed"
    );
    expect(metrics).toEqual([
      expect.objectContaining({
        job: "count",
        outcome: "retry",
        queueAgeMs: expect.any(Number),
      }),
    ]);
  });
});

import { describe, expect, mock, test } from "bun:test";

import {
  readMessageSearchWorkerFeatures,
  sweepMessageSearchWork,
} from "./message-search-sweep";

function createDependencies() {
  return {
    enqueueBackfill: mock(() => Promise.resolve()),
    enqueueBackfillOutbox: mock(() => Promise.resolve()),
    enqueueCount: mock(() => Promise.resolve()),
    enqueueLiveOutbox: mock(() => Promise.resolve()),
    expireStaleCounts: mock(() => Promise.resolve()),
    listPendingOutbox: mock(() =>
      Promise.resolve([
        { id: "live-1", kind: "upsert" },
        { id: "backfill-1", kind: "backfill" },
      ])
    ),
    listRunnableBackfills: mock(() =>
      Promise.resolve([
        { conversationId: "conversation-1", cursorMessageId: "message-10" },
      ])
    ),
    listRunnableCounts: mock(() => Promise.resolve(["count-1"])),
  };
}

describe("message-search worker sweep", () => {
  test("defaults worker queues on and parses independent pause values", () => {
    expect(readMessageSearchWorkerFeatures({})).toEqual({
      backfill: true,
      counts: true,
    });
    expect(
      readMessageSearchWorkerFeatures({
        MESSAGE_SEARCH_BACKFILL_ENABLED: "off",
        MESSAGE_SEARCH_COUNT_ENABLED: "1",
      })
    ).toEqual({ backfill: false, counts: true });
  });

  test("keeps live indexing active while paused backfill and count work stays durable", async () => {
    const dependencies = createDependencies();
    await sweepMessageSearchWork(
      { backfill: false, counts: false },
      dependencies
    );

    expect(dependencies.listPendingOutbox).toHaveBeenCalledWith(100, false);
    expect(dependencies.enqueueLiveOutbox).toHaveBeenCalledWith("live-1");
    expect(dependencies.enqueueBackfillOutbox).not.toHaveBeenCalled();
    expect(dependencies.listRunnableBackfills).not.toHaveBeenCalled();
    expect(dependencies.enqueueBackfill).not.toHaveBeenCalled();
    expect(dependencies.expireStaleCounts).toHaveBeenCalledTimes(1);
    expect(dependencies.listRunnableCounts).not.toHaveBeenCalled();
    expect(dependencies.enqueueCount).not.toHaveBeenCalled();
  });

  test("schedules live, historical, and count work when each switch is enabled", async () => {
    const dependencies = createDependencies();
    await sweepMessageSearchWork(
      { backfill: true, counts: true },
      dependencies
    );

    expect(dependencies.listPendingOutbox).toHaveBeenCalledWith(100, true);
    expect(dependencies.enqueueLiveOutbox).toHaveBeenCalledWith("live-1");
    expect(dependencies.enqueueBackfillOutbox).toHaveBeenCalledWith(
      "backfill-1"
    );
    expect(dependencies.listRunnableBackfills).toHaveBeenCalledWith(20);
    expect(dependencies.enqueueBackfill).toHaveBeenCalledWith(
      "conversation-1",
      "message-10"
    );
    expect(dependencies.listRunnableCounts).toHaveBeenCalledWith(20);
    expect(dependencies.enqueueCount).toHaveBeenCalledWith("count-1");
  });

  test("propagates queue failures so the worker can report and retry on its next sweep", async () => {
    const dependencies = createDependencies();
    dependencies.enqueueLiveOutbox.mockRejectedValueOnce(
      new Error("Redis unavailable")
    );

    await expect(
      sweepMessageSearchWork({ backfill: true, counts: true }, dependencies)
    ).rejects.toThrow("Redis unavailable");
  });
});

import { describe, expect, mock, test } from "bun:test";

import { dispatchMessageSearchBackfillJob } from "./message-search-queue";

describe("message-search backfill queue dispatch", () => {
  test("indexes outbox jobs instead of interpreting them as conversation walks", async () => {
    const enqueueConversationBackfill = mock(() => Promise.resolve());
    const indexOutbox = mock(() => Promise.resolve());
    const processConversationBackfill = mock(() => Promise.resolve(null));

    await dispatchMessageSearchBackfillJob(
      { data: { outboxId: "outbox-1" }, name: "index-message-outbox" },
      {
        enqueueConversationBackfill,
        indexOutbox,
        processConversationBackfill,
      }
    );

    expect(indexOutbox).toHaveBeenCalledWith("outbox-1");
    expect(processConversationBackfill).not.toHaveBeenCalled();
    expect(enqueueConversationBackfill).not.toHaveBeenCalled();
  });

  test("continues conversation backfills from the returned cursor", async () => {
    const enqueueConversationBackfill = mock(() => Promise.resolve());
    const indexOutbox = mock(() => Promise.resolve());
    const processConversationBackfill = mock(() =>
      Promise.resolve("message-100")
    );

    await dispatchMessageSearchBackfillJob(
      {
        data: { conversationId: "conversation-1" },
        name: "index-conversation-search-backfill",
      },
      {
        enqueueConversationBackfill,
        indexOutbox,
        processConversationBackfill,
      }
    );

    expect(processConversationBackfill).toHaveBeenCalledWith("conversation-1");
    expect(enqueueConversationBackfill).toHaveBeenCalledWith(
      "conversation-1",
      "message-100"
    );
    expect(indexOutbox).not.toHaveBeenCalled();
  });

  test("rejects malformed durable job payloads", async () => {
    const handlers = {
      enqueueConversationBackfill: mock(() => Promise.resolve()),
      indexOutbox: mock(() => Promise.resolve()),
      processConversationBackfill: mock(() => Promise.resolve(null)),
    };

    await expect(
      dispatchMessageSearchBackfillJob(
        { data: { outboxId: 1 }, name: "index-message-outbox" },
        handlers
      )
    ).rejects.toThrow("Invalid DM search outbox job payload");
    await expect(
      dispatchMessageSearchBackfillJob({ data: {}, name: "backfill" }, handlers)
    ).rejects.toThrow("Invalid DM search backfill job payload");
  });
});

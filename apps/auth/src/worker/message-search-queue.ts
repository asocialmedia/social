export interface MessageSearchBackfillQueueJob {
  data: Record<string, unknown>;
  name: string;
}

export interface MessageSearchBackfillQueueHandlers {
  enqueueConversationBackfill: (
    conversationId: string,
    cursorMessageId: string
  ) => Promise<void>;
  indexOutbox: (outboxId: string) => Promise<void>;
  processConversationBackfill: (
    conversationId: string
  ) => Promise<string | null>;
}

export async function dispatchMessageSearchBackfillJob(
  job: MessageSearchBackfillQueueJob,
  handlers: MessageSearchBackfillQueueHandlers
): Promise<void> {
  if (job.name === "index-message-outbox") {
    const { outboxId } = job.data;
    if (typeof outboxId !== "string" || outboxId.length === 0) {
      throw new Error("Invalid DM search outbox job payload");
    }
    await handlers.indexOutbox(outboxId);
    return;
  }

  const { conversationId } = job.data;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    throw new Error("Invalid DM search backfill job payload");
  }
  const cursorMessageId =
    await handlers.processConversationBackfill(conversationId);
  if (cursorMessageId) {
    await handlers.enqueueConversationBackfill(
      conversationId,
      cursorMessageId
    );
  }
}

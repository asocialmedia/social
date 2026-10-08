export interface MessageSearchWorkerFeatures {
  backfill: boolean;
  counts: boolean;
}

export interface MessageSearchWorkerEnvironment {
  MESSAGE_SEARCH_BACKFILL_ENABLED?: string;
  MESSAGE_SEARCH_COUNT_ENABLED?: string;
}

function isFeatureEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized ?? "");
}

export function readMessageSearchWorkerFeatures(
  environment: MessageSearchWorkerEnvironment
): MessageSearchWorkerFeatures {
  return {
    backfill: isFeatureEnabled(environment.MESSAGE_SEARCH_BACKFILL_ENABLED),
    counts: isFeatureEnabled(environment.MESSAGE_SEARCH_COUNT_ENABLED),
  };
}

export interface MessageSearchSweepOutboxItem {
  id: string;
  kind: string;
}

export interface MessageSearchSweepBackfill {
  conversationId: string;
  cursorMessageId: string | null;
}

export interface MessageUnreadCounterTask {
  conversationId: string;
  userId: string;
}

export interface MessageSearchSweepDependencies {
  enqueueBackfill: (
    conversationId: string,
    cursorMessageId: string | null
  ) => Promise<void>;
  enqueueBackfillOutbox: (outboxId: string) => Promise<void>;
  enqueueCount: (requestId: string) => Promise<void>;
  enqueueLiveOutbox: (outboxId: string) => Promise<void>;
  enqueueUnreadCounter: (task: MessageUnreadCounterTask) => Promise<void>;
  expireStaleCounts: () => Promise<void>;
  listPendingOutbox: (
    limit: number,
    includeBackfill: boolean
  ) => Promise<readonly MessageSearchSweepOutboxItem[]>;
  listRunnableBackfills: (
    limit: number
  ) => Promise<readonly MessageSearchSweepBackfill[]>;
  listRunnableCounts: (limit: number) => Promise<readonly string[]>;
  listRunnableUnreadCounters: (
    limit: number
  ) => Promise<readonly MessageUnreadCounterTask[]>;
}

export async function sweepMessageSearchWork(
  features: MessageSearchWorkerFeatures,
  dependencies: MessageSearchSweepDependencies
): Promise<void> {
  const pending = await dependencies.listPendingOutbox(100, features.backfill);
  const actionable = features.backfill
    ? pending
    : pending.filter((item) => item.kind !== "backfill");
  await Promise.all(
    actionable.map((item) =>
      item.kind === "backfill"
        ? dependencies.enqueueBackfillOutbox(item.id)
        : dependencies.enqueueLiveOutbox(item.id)
    )
  );

  if (features.backfill) {
    const backfills = await dependencies.listRunnableBackfills(20);
    await Promise.all(
      backfills.map((item) =>
        dependencies.enqueueBackfill(item.conversationId, item.cursorMessageId)
      )
    );
  }

  await dependencies.expireStaleCounts();
  if (features.counts) {
    const countRequests = await dependencies.listRunnableCounts(20);
    await Promise.all(
      countRequests.map((requestId) => dependencies.enqueueCount(requestId))
    );
  }

  const unreadCounters = await dependencies.listRunnableUnreadCounters(100);
  await Promise.all(
    unreadCounters.map((task) => dependencies.enqueueUnreadCounter(task))
  );
}

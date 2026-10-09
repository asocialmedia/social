import type { DurableMessageChange } from "./durable-change-replay";
import type { OfflineSearchCacheRemoval } from "./indexeddb-offline-search-cache";

export interface OfflineSearchChangePlan {
  invalidateDecryptIds: string[];
  messageIds: string[];
  removals: OfflineSearchCacheRemoval[];
  unavailableIds: string[];
}

export function shouldRefreshServerSearchSnapshot(
  changes: readonly DurableMessageChange[],
  resetRequired: boolean
): boolean {
  return (
    resetRequired || changes.some((change) => change.kind !== "message.created")
  );
}

export function planOfflineSearchChangeEffects(
  changes: readonly DurableMessageChange[]
): OfflineSearchChangePlan {
  const latestByMessage = new Map<
    string,
    { change: DurableMessageChange; unavailable: boolean }
  >();
  const invalidateDecryptIds = new Set<string>();

  for (const change of changes) {
    if (!change.messageId) {
      continue;
    }
    const unavailable =
      change.globallyDeleted ||
      change.hiddenForViewer ||
      !change.sourceAvailable;
    const prior = latestByMessage.get(change.messageId);
    if (!prior || change.sequence >= prior.change.sequence) {
      latestByMessage.set(change.messageId, { change, unavailable });
    }
    if (change.kind === "message.edited" && !unavailable) {
      invalidateDecryptIds.add(change.messageId);
    }
  }

  const ordered = [...latestByMessage.entries()].toSorted(
    ([leftId], [rightId]) => leftId.localeCompare(rightId)
  );
  const removals = ordered.map(([id, { change, unavailable }]) => ({
    id,
    revisionFloor: unavailable
      ? null
      : (change.sourceRevision ?? change.revision),
    sequence: change.sequence,
    unavailable,
  }));
  return {
    invalidateDecryptIds: [...invalidateDecryptIds].toSorted(),
    messageIds: ordered.map(([id]) => id),
    removals,
    unavailableIds: removals
      .filter((removal) => removal.unavailable)
      .map((removal) => removal.id),
  };
}

// Shared render and read admission rules for the web and native feed adapters.
// Refresh owns the feed until it settles. Head reads and tail reads may finish
// independently, but admission waits for the active tail to keep anchors stable.
export interface FeedRenderState {
  active: boolean;
  initialLoading: boolean;
  refreshing: boolean;
  paging: boolean;
  offset: number;
  pendingHeadCount: number;
}

export function feedRenderPolicy(state: FeedRenderState) {
  const ready = state.active && !state.initialLoading && !state.refreshing;
  return {
    admitHead:
      ready &&
      !state.paging &&
      state.offset >= 16 &&
      state.pendingHeadCount > 0,
    loadTail: ready && !state.paging,
    showInitialSkeleton: state.initialLoading,
  };
}

// Notices are independent of source buffers: admitting a head does not mark it
// read. Clear them only on acknowledgement or a scope-changing refresh.
export function mergeUnreadFeedHead<T extends { id: string }>(
  previous: readonly T[],
  incoming: readonly T[]
): T[] {
  return [
    ...new Map(
      [...previous, ...incoming].map((item) => [item.id, item])
    ).values(),
  ];
}
// Keep pagination below the reader even when a generator returns newer dates.
// Only items explicitly prepended to a source may move ahead of existing rows.
export function reconcileFeedOrder<T extends { id: string }>(
  previous: readonly T[],
  incoming: readonly T[],
  sourceOrders: readonly (readonly string[])[]
): T[] {
  const previousIds = new Set(previous.map((item) => item.id));
  const current = new Map(incoming.map((item) => [item.id, item]));
  if (!previous.some((item) => current.has(item.id))) {
    return [...incoming];
  }
  const prepended = new Set<string>();
  for (const ids of sourceOrders) {
    const firstKnown = ids.findIndex((id) => previousIds.has(id));
    if (firstKnown > 0) {
      for (const id of ids.slice(0, firstKnown)) {
        prepended.add(id);
      }
    }
  }
  return [
    ...incoming.filter((item) => prepended.has(item.id)),
    ...previous.flatMap((item) => {
      const updated = current.get(item.id);
      return updated ? [updated] : [];
    }),
    ...incoming.filter(
      (item) => !previousIds.has(item.id) && !prepended.has(item.id)
    ),
  ];
}

// Protocol identity is distinct from the app account ID. While checking a
// linked account, withhold the control rather than briefly offering self-follow.
export function canFollowPostAuthor(input: {
  authorId: string | null | undefined;
  viewerId?: string | null;
  externalDid?: string;
  viewerDid?: string | null;
  connectionKnown?: boolean;
}) {
  if (!input.authorId || input.authorId === input.viewerId) {
    return false;
  }
  if (input.externalDid && input.viewerId) {
    return Boolean(
      input.connectionKnown && input.externalDid !== input.viewerDid
    );
  }
  return true;
}

import type { QueryClient } from "@tanstack/react-query";

// Generic cache walker: for every query in the cache, deep-walk its data and
// call `patch` on matching leaves. Returns the old data unchanged when nothing
// matched/ changed, so React Query does not notify subscribers for no-ops.
function updateCacheByPredicate(
  queryClient: QueryClient,
  isMatch: (record: Record<string, unknown>) => boolean,
  patch: (record: Record<string, unknown>) => Record<string, unknown>
): void {
  queryClient.setQueriesData({ queryKey: [] }, (oldData) => {
    if (!oldData || typeof oldData !== "object") {
      return oldData;
    }
    return walk(oldData, isMatch, patch);
  });
}

function walk(
  node: unknown,
  isMatch: (record: Record<string, unknown>) => boolean,
  patch: (record: Record<string, unknown>) => Record<string, unknown>
): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const updated = walk(item, isMatch, patch);
      if (updated !== item) {
        changed = true;
      }
      return updated;
    });
    return changed ? next : node;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (isMatch(record)) {
      const updated = patch(record);
      return updated === record ? node : updated;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const updated = walk(value, isMatch, patch);
      next[key] = updated;
      if (updated !== value) {
        changed = true;
      }
    }
    return changed ? next : node;
  }
  return node;
}

// Mirrors a post's aura/vote state into every cached shape that carries a
// PostData-like object (feed pages, single-post caches, grids, rails). The
// vote buttons read live values from ["vote-info", postId], but places that
// display post.aura directly (explore grids, profile gust tiles) read from
// their feed cache, so those need the update pushed into them too.
export function applyAuraToCaches(
  queryClient: QueryClient,
  postId: string,
  aura: number,
  userVote: number
): void {
  updateCacheByPredicate(
    queryClient,
    (record) => record.id === postId && typeof record.aura === "number",
    (record) => {
      const currentAura = record.aura as number;
      const currentVote = Array.isArray(record.vote)
        ? (record.vote[0] as { userId?: string; value?: number } | undefined)
        : undefined;
      const currentValue = currentVote?.value ?? 0;
      // Preserve the existing vote owner (only the current user's vote is
      // replaced); no-op when nothing changed so subscribers aren't notified.
      if (currentAura === aura && currentValue === userVote) {
        return record;
      }
      return {
        ...record,
        aura,
        vote:
          userVote === 0
            ? []
            : [
                {
                  userId: currentVote?.userId ?? "currentUser",
                  value: userVote,
                },
              ],
      };
    }
  );
}

// Mirrors a comment's aura into every cached shape that carries a comment
// object (the ["comments", postId] list). Voting on an eddie updates the aura
// shown in the thread immediately.
export function applyCommentAuraToCaches(
  queryClient: QueryClient,
  commentId: string,
  aura: number
): void {
  updateCacheByPredicate(
    queryClient,
    (record) => record.id === commentId && typeof record.aura === "number",
    (record) => {
      if (record.aura === aura) {
        return record;
      }
      return { ...record, aura };
    }
  );
}

// Mirrors a viewCount into every cached shape that carries a post. Used by the
// batched view flush so feed/grid/rail counts update without a refetch.
export function applyViewCountToCaches(
  queryClient: QueryClient,
  postId: string,
  viewCount: number
): void {
  updateCacheByPredicate(
    queryClient,
    (record) => record.id === postId && typeof record.viewCount === "number",
    (record) => {
      if (record.viewCount === viewCount) {
        return record;
      }
      return { ...record, viewCount };
    }
  );
}

// Mirrors a comment count change (delta) into every cached shape that carries a post
// (_count.comments on feeds, bookmarks, search, profiles, single post).
export function applyCommentCountDeltaToCaches(
  queryClient: QueryClient,
  postId: string,
  delta: number
): void {
  updateCacheByPredicate(
    queryClient,
    (record) =>
      record.id === postId &&
      typeof record._count === "object" &&
      record._count !== null,
    (record) => {
      const countObj = record._count as {
        comments?: number;
        [key: string]: unknown;
      };
      if (typeof countObj.comments !== "number") {
        return record;
      }
      const newCount = Math.max(0, countObj.comments + delta);
      if (newCount === countObj.comments) {
        return record;
      }
      return {
        ...record,
        _count: {
          ...countObj,
          comments: newCount,
        },
      };
    }
  );
}

// Heals stale PostData that lost its viewer-scoped `bookmarks` (and `vote`)
// join during serialization or optimistic construction. Runs as a synchronous
// patch over every cached query so the UI stops crashing immediately; the
// caller should then invalidate the affected queries to revalidate from the
// server Data Cache (`hydrateViewCounts` now guarantees the shape).
function isStalePostRecord(record: Record<string, unknown>): boolean {
  if (typeof record.id !== "string" || typeof record.content !== "string") {
    return false;
  }
  if (typeof record.aura !== "number" || typeof record.userId !== "string") {
    return false;
  }
  return (
    !Array.isArray(record.bookmarks) ||
    !Array.isArray(record.vote) ||
    !Array.isArray(record.attachments) ||
    !Array.isArray(record.tags) ||
    !Array.isArray(record.mentions) ||
    !record._count ||
    typeof record._count !== "object" ||
    Array.isArray(record._count) ||
    typeof (record._count as Record<string, unknown>).comments !== "number" ||
    typeof (record._count as Record<string, unknown>).mentions !== "number" ||
    typeof (record._count as Record<string, unknown>).vote !== "number"
  );
}

function hasStalePostData(data: unknown): boolean {
  let found = false;
  walkForStale(data, (record) => {
    if (isStalePostRecord(record)) {
      found = true;
    }
  });
  return found;
}

export function repairStalePostCaches(queryClient: QueryClient): boolean {
  // Avoid calling setQueriesData when there is nothing stale - otherwise the
  // queryCache.subscribe listener (FeedView) would be retriggered on every
  // cache write and recurse infinitely. Pre-scan first without writing.
  let hasStale = false;
  for (const query of queryClient.getQueryCache().findAll()) {
    const { data } = query.state;
    if (!data || typeof data !== "object") {
      continue;
    }
    if (hasStalePostData(data)) {
      hasStale = true;
      break;
    }
  }
  if (!hasStale) {
    return false;
  }
  let repaired = false;
  updateCacheByPredicate(queryClient, isStalePostRecord, (record) => {
    repaired = true;
    const count = record._count as Record<string, unknown> | undefined;
    return {
      ...record,
      _count:
        count && typeof count === "object" && !Array.isArray(count)
          ? {
              ...count,
              comments: typeof count.comments === "number" ? count.comments : 0,
              mentions: typeof count.mentions === "number" ? count.mentions : 0,
              vote: typeof count.vote === "number" ? count.vote : 0,
            }
          : { comments: 0, mentions: 0, vote: 0 },
      attachments: Array.isArray(record.attachments) ? record.attachments : [],
      bookmarks: Array.isArray(record.bookmarks) ? record.bookmarks : [],
      mentions: Array.isArray(record.mentions) ? record.mentions : [],
      tags: Array.isArray(record.tags) ? record.tags : [],
      vote: Array.isArray(record.vote) ? record.vote : [],
    };
  });
  return repaired;
}

export function forceInvalidatePostFeeds(queryClient: QueryClient): void {
  for (const key of [
    ["post-feed"],
    ["gusts-feed"],
    ["related-posts"],
    ["post-history"],
    ["popularTags"],
  ] as const) {
    void queryClient.invalidateQueries({
      queryKey: key as unknown as unknown[],
    });
  }
}

export function invalidateStalePostCaches(queryClient: QueryClient): boolean {
  const staleKeys = new Set<string>();
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll()) {
    const { data } = query.state;
    if (!data || typeof data !== "object") {
      continue;
    }
    if (hasStalePostData(data)) {
      staleKeys.add(JSON.stringify(query.queryKey));
    }
  }
  if (staleKeys.size === 0) {
    return false;
  }
  forceInvalidatePostFeeds(queryClient);
  // Also invalidate any exact stale keys not covered by the broad set.
  for (const raw of staleKeys) {
    try {
      const key = JSON.parse(raw) as unknown[];
      void queryClient.invalidateQueries({ queryKey: key });
    } catch {
      // ignore
    }
  }
  return true;
}

function walkForStale(
  node: unknown,
  onRecord: (record: Record<string, unknown>) => void
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walkForStale(item, onRecord);
    }
    return;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    onRecord(record);
    for (const value of Object.values(record)) {
      walkForStale(value, onRecord);
    }
  }
}

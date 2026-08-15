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
// object (the ["comments", postId] list). Voting on an eddy updates the aura
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

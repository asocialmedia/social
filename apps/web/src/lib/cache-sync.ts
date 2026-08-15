import type { QueryClient } from "@tanstack/react-query";

// Mirrors a post's aura/vote state into every cached shape that carries a
// PostData-like object (feed pages, single-post caches, grids, rails). The
// vote buttons read live values from ["vote-info", postId], but places that
// display post.aura directly (explore grids, profile gust tiles) read from
// their feed cache, so those need the update pushed into them too. A deep walk
// over the whole query cache keeps them in sync without knowing every key.
export function applyAuraToCaches(
  queryClient: QueryClient,
  postId: string,
  aura: number,
  userVote: number
): void {
  queryClient.setQueriesData({ queryKey: [] }, (oldData) => {
    if (!oldData || typeof oldData !== "object") {
      return oldData;
    }
    return updatePostDeep(oldData, postId, aura, userVote);
  });
}

function updatePostDeep(
  node: unknown,
  postId: string,
  aura: number,
  userVote: number
): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const updated = updatePostDeep(item, postId, aura, userVote);
      if (updated !== item) {
        changed = true;
      }
      return updated;
    });
    return changed ? next : node;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.id === postId && typeof record.aura === "number") {
      return {
        ...record,
        aura,
        vote:
          userVote === 0 ? [] : [{ userId: "currentUser", value: userVote }],
      };
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const updated = updatePostDeep(value, postId, aura, userVote);
      next[key] = updated;
      if (updated !== value) {
        changed = true;
      }
    }
    return changed ? next : node;
  }
  return node;
}

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

// Mirrors a comment's aura into every cached shape that carries a comment
// object (the ["comments", postId] list). Voting on an eddy updates the aura
// shown in the thread immediately; the comment vote buttons read live state
// from ["comment-vote", commentId] but the rendered number comes from the
// cached comment.
export function applyCommentAuraToCaches(
  queryClient: QueryClient,
  commentId: string,
  aura: number
): void {
  queryClient.setQueriesData({ queryKey: [] }, (oldData) => {
    if (!oldData || typeof oldData !== "object") {
      return oldData;
    }
    return updateCommentDeep(oldData, commentId, aura);
  });
}

function updateCommentDeep(
  node: unknown,
  commentId: string,
  aura: number
): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const updated = updateCommentDeep(item, commentId, aura);
      if (updated !== item) {
        changed = true;
      }
      return updated;
    });
    return changed ? next : node;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.id === commentId && typeof record.aura === "number") {
      if (record.aura === aura) {
        return node;
      }
      return { ...record, aura };
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const updated = updateCommentDeep(value, commentId, aura);
      next[key] = updated;
      if (updated !== value) {
        changed = true;
      }
    }
    return changed ? next : node;
  }
  return node;
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

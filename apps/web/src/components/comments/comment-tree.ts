import type { CommentData } from "@asm/db";

export interface CommentNode {
  children: CommentNode[];
  comment: CommentData;
  depth: number;
}

// Nesting deeper than this is rendered flat (no further indentation) to keep
// deep threads from pushing content into a thin sliver, Reddit-style.
export const MAX_COMMENT_DEPTH = 6;

// Builds a Reddit-style thread from a flat list. Top-level comments sort
// newest-first (matching the "load previous eddies" pagination), while replies
// within a thread sort oldest-first so the conversation reads top to bottom.
// Comments whose parent has not been loaded yet are kept out of the tree until
// their ancestor arrives (realtime replies to an unloaded page).
export function buildCommentTree(comments: CommentData[]): CommentNode[] {
  const byId = new Map<string, CommentData>();
  for (const comment of comments) {
    byId.set(comment.id, comment);
  }

  const childrenOf = new Map<string, CommentData[]>();
  const roots: CommentData[] = [];

  for (const comment of comments) {
    if (comment.parentId && byId.has(comment.parentId)) {
      const siblings = childrenOf.get(comment.parentId) ?? [];
      siblings.push(comment);
      childrenOf.set(comment.parentId, siblings);
    } else {
      roots.push(comment);
    }
  }

  roots.sort((a, b) => {
    const byTime = b.createdAt.getTime() - a.createdAt.getTime();
    return byTime === 0 ? b.id.localeCompare(a.id) : byTime;
  });

  const build = (comment: CommentData, depth: number): CommentNode | null => {
    const rawChildren = childrenOf.get(comment.id) ?? [];
    rawChildren.sort((a, b) => {
      const byTime = a.createdAt.getTime() - b.createdAt.getTime();
      return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
    });

    const children: CommentNode[] = [];
    for (const child of rawChildren) {
      const built = build(child, depth + 1);
      if (built) {
        children.push(built);
      }
    }

    // A deleted comment with no remaining children is pruned so empty removed placeholders
    // don't linger; if it has children, it is preserved to keep the thread tree intact.
    if (comment.deleted && children.length === 0) {
      return null;
    }

    return {
      children,
      comment,
      depth,
    };
  };

  const tree: CommentNode[] = [];
  for (const root of roots) {
    const built = build(root, 0);
    if (built) {
      tree.push(built);
    }
  }
  return tree;
}

// Folds the realtime/optimistic live store over the server-fetched pages.
// Server wins for a comment that also exists in the live store, except that a
// live soft-delete is applied on top so removed eddies disappear immediately.
export function mergeCommentsWithLive(
  serverComments: CommentData[],
  live: Map<string, CommentData>
): CommentData[] {
  const byId = new Map<string, CommentData>();
  for (const comment of serverComments) {
    byId.set(comment.id, comment);
  }
  for (const comment of live.values()) {
    const existing = byId.get(comment.id);
    if (!existing) {
      byId.set(comment.id, comment);
    } else if (comment.deleted) {
      byId.set(comment.id, { ...existing, content: "", deleted: true });
    }
  }
  return [...byId.values()];
}

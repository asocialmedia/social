// Eddie thread shaping, ported from web's components/comments/thread/
// comment-tree.ts. The API returns a flat page (top-level eddies plus every
// descendant); the tree is built client-side:
// - top-level newest first, replies oldest first (ties broken by id)
// - replies indent up to MAX_EDDIE_DEPTH, deeper ones render at that indent
// - a deleted eddie with no remaining children is pruned; one with children
//   stays as a placeholder so the thread keeps its shape
// Plus the local mutations the composers and delete dialog apply.

import type { FeedComment } from "@/features/feed/lib/feed-api";

export const MAX_EDDIE_DEPTH = 6;

export interface EddieNode {
  children: EddieNode[];
  comment: FeedComment;
  depth: number;
}

function stamp(comment: FeedComment): number {
  const time = Date.parse(comment.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

export function buildEddieTree(comments: readonly FeedComment[]): EddieNode[] {
  const byId = new Map<string, FeedComment>();
  for (const comment of comments) {
    byId.set(comment.id, comment);
  }
  const childrenOf = new Map<string, FeedComment[]>();
  const roots: FeedComment[] = [];
  for (const comment of byId.values()) {
    if (comment.parentId && byId.has(comment.parentId)) {
      const siblings = childrenOf.get(comment.parentId) ?? [];
      siblings.push(comment);
      childrenOf.set(comment.parentId, siblings);
    } else {
      roots.push(comment);
    }
  }
  roots.sort((a, b) => stamp(b) - stamp(a) || b.id.localeCompare(a.id));

  const build = (comment: FeedComment, depth: number): EddieNode | null => {
    const rawChildren = [...(childrenOf.get(comment.id) ?? [])].toSorted(
      (a, b) => stamp(a) - stamp(b) || a.id.localeCompare(b.id)
    );
    const children: EddieNode[] = [];
    for (const child of rawChildren) {
      const built = build(child, depth + 1);
      if (built) {
        children.push(built);
      }
    }
    if (comment.deleted && children.length === 0) {
      return null;
    }
    return { children, comment, depth };
  };

  const tree: EddieNode[] = [];
  for (const root of roots) {
    const built = build(root, 0);
    if (built) {
      tree.push(built);
    }
  }
  return tree;
}

// Merges pages without duplicating eddies that appear in both.
export function mergeEddies(
  current: readonly FeedComment[],
  incoming: readonly FeedComment[]
): FeedComment[] {
  const byId = new Map<string, FeedComment>();
  for (const comment of current) {
    byId.set(comment.id, comment);
  }
  for (const comment of incoming) {
    byId.set(comment.id, comment);
  }
  return [...byId.values()];
}

// A freshly created eddie (the POST response) joins the flat list at once.
export function withCreatedEddie(
  current: readonly FeedComment[],
  created: FeedComment
): FeedComment[] {
  return mergeEddies(current, [created]);
}

// Soft delete mirrored locally: content cleared, flagged deleted (the tree
// then prunes it if it has no replies).
export function withDeletedEddie(
  current: readonly FeedComment[],
  commentId: string
): FeedComment[] {
  return current.map((comment) =>
    comment.id === commentId
      ? { ...comment, attachments: [], content: "", deleted: true }
      : comment
  );
}

export function countVisible(nodes: readonly EddieNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1 + countVisible(node.children);
  }
  return total;
}

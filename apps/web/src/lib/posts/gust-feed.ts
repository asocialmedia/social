import type { PresentedPost } from "./presentation";

export interface GustPagingProgress {
  scope: string;
  pages: number;
  visible: number;
  emptyPages: number;
}

export function advanceGustPaging(
  previous: GustPagingProgress,
  scope: string,
  pages: number,
  visible: number
): GustPagingProgress {
  if (
    previous.scope !== scope ||
    pages < previous.pages ||
    visible > previous.visible
  ) {
    return { emptyPages: 0, pages, scope, visible };
  }
  return {
    emptyPages: previous.emptyPages + Math.max(0, pages - previous.pages),
    pages,
    scope,
    visible,
  };
}

// Fill the reel from both networks without moving clips the viewer has already loaded.
export function mergeGustPosts(
  previous: readonly PresentedPost[],
  native: readonly PresentedPost[],
  external: readonly PresentedPost[]
): PresentedPost[] {
  const candidates: PresentedPost[] = [];
  const count = Math.max(native.length, external.length);
  for (let index = 0; index < count; index += 1) {
    if (native[index]) {
      candidates.push(native[index]);
    }
    if (external[index]) {
      candidates.push(external[index]);
    }
  }
  const current = new Map(candidates.map((post) => [post.id, post]));
  const retained = previous.flatMap((post) => {
    const updated = current.get(post.id);
    current.delete(post.id);
    return updated ? [updated] : [];
  });
  return [...retained, ...current.values()];
}

// Sparse video pages keep their continuation, with a capped delay rather than a permanent paging stop.
export function gustPagingDelay(emptyPages: number): number {
  return emptyPages < 3
    ? 0
    : Math.min(8000, 500 * 2 ** Math.min(4, emptyPages - 3));
}

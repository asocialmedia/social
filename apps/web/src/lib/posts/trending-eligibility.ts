import { isExternalTrendingPost } from "@asm/protocols/discovery";

import type { PresentedPost } from "./presentation";

// Views and ranking scores alone do not make an ASM post trending.
export function isTrendingPost(
  post: Pick<PresentedPost, "_count" | "external">
): boolean {
  if (post.external) {
    return isExternalTrendingPost(post.external);
  }
  const counts = post._count;
  return [
    counts?.vote,
    counts?.comments,
    counts?.bookmarks,
    counts?.responses,
  ].some((count) => Number.isFinite(count) && count > 0);
}

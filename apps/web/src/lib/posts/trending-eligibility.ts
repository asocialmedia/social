import { isExternalTrendingPost } from "@asm/protocols/discovery";

import type { PresentedPost } from "./presentation";

// Views and ranking scores alone do not make an ASM post trending.
// Aura is the stored net-vote score, so it still proves somebody engaged even
// when the viewer-scoped counters are empty for this reader.
export function isTrendingPost(
  post: Pick<PresentedPost, "_count" | "external" | "aura">
): boolean {
  if (post.external) {
    return isExternalTrendingPost(post.external);
  }
  const counts = post._count;
  if (
    [counts?.vote, counts?.comments, counts?.bookmarks, counts?.responses].some(
      (count) => Number.isFinite(count) && count > 0
    )
  ) {
    return true;
  }
  return Number.isFinite(post.aura) && post.aura > 0;
}

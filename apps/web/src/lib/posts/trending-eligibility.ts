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

// Guests have no persona, so their feeds are not "personalized" and not
// "trending" either: they need content that is demonstrably well received but
// not necessarily the current hot list. A positive stored aura proves net
// positive votes even when the viewer-scoped counters come back empty, which is
// what keeps a guest feed from going blank on a young network.
export function isGuestQualityPost(
  post: Pick<PresentedPost, "_count" | "external" | "aura">
): boolean {
  if (isTrendingPost(post)) {
    return true;
  }
  return Number.isFinite(post.aura) && post.aura > 0;
}

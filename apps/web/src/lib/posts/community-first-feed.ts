// Pure helpers behind the community-first related feed on a community post's
// detail page. The feed leads with the post's own community, then falls through
// to the platform. Kept dependency-free so the segment/pagination rules are
// unit-testable without rendering the feed.

export interface CommunityFirstInput<T extends { id: string }> {
  communityPosts: T[];
  globalPosts: T[];
}

export interface CommunityFirstSegments<T> {
  // The community segment, deduped, in its given order.
  communityPosts: T[];
  // The global segment with any post already led by the community removed, so
  // the same post never renders twice when both queries' windows overlap.
  globalPosts: T[];
}

// Splits the two source lists into the two rendered segments, dropping global
// duplicates of posts the community segment already shows.
export function splitCommunityFirstSegments<T extends { id: string }>({
  communityPosts,
  globalPosts,
}: CommunityFirstInput<T>): CommunityFirstSegments<T> {
  const communityIds = new Set(communityPosts.map((post) => post.id));
  return {
    communityPosts,
    globalPosts: globalPosts.filter((post) => !communityIds.has(post.id)),
  };
}

export type FeedSegment = "community" | "global" | "none";

export interface NextSegmentInput {
  // True while the community segment still has usable posts on screen.
  hasCommunityLead: boolean;
  // True once the community segment has run out of pages or hit its lead cap.
  communityExhausted: boolean;
  globalHasNextPage: boolean;
}

// Which source the next "bottom reached" fetch should advance. The community
// segment always gets priority until it is exhausted, then the global feed.
export function nextFeedSegment({
  communityExhausted,
  globalHasNextPage,
  hasCommunityLead,
}: NextSegmentInput): FeedSegment {
  if (hasCommunityLead && !communityExhausted) {
    return "community";
  }
  return globalHasNextPage ? "global" : "none";
}

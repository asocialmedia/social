import type { FeedPost } from "@/features/feed/lib/feed-types";

// Viewability already excludes cards with less than 70% visible for 300 ms.
// Keep the current owner until it leaves that region to avoid decoder churn.
export function selectExploreAutoplayPost(
  posts: readonly FeedPost[],
  current: string | null
): string | null {
  const candidates = posts.filter(
    (post) =>
      !post.explicitContent &&
      !post.moderated &&
      post.attachments?.find(
        (media) => media.type === "IMAGE" || media.type === "VIDEO"
      )?.type === "VIDEO"
  );
  return (
    candidates.find((post) => post.id === current)?.id ??
    candidates[0]?.id ??
    null
  );
}

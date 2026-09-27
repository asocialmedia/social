// What happens to the home feed the moment a fleet is published: the Latest
// tab is selected and the new post is put at its head.
//
// The reader is usually on For you when they write, and that tab is ranked -
// a brand new post has no engagement and would not surface there at all. So
// the tab they are sent to is the one guaranteed to contain what they just
// wrote, and the post is inserted optimistically rather than waited for, which
// is the whole point: the feed is already correct when the pager finishes
// sliding, with no refetch flash in between.
//
// Only plain fleets do this. A gust belongs to the reels feed and a response to
// the thread it was written in; both are routed by the caller instead.
import type { FeedPost } from "../lib/feed-types";
import { feedCache, requestFeedTop } from "./feed-store";
import { useTabStore } from "./tab-store-native";

/** The feed cache keys Latest under, matching use-feed's `${variant}:${user}`. */
export function latestFeedKey(userId: string | undefined): string {
  return `latest:${userId ?? "guest"}`;
}

export function revealPublishedPost(
  post: FeedPost,
  userId: string | undefined
): void {
  feedCache.showPublishedPost(latestFeedKey(userId), post);
  // The reader is being moved to the top of that feed, so drop them there
  // rather than at whatever offset they last left it at.
  requestFeedTop("latest");
  useTabStore.getState().setHomeTab("latest", userId);
}

import { groupPostsIntoThreads } from "./feed-types";
import type { FeedPost, FeedThreadGroup } from "./feed-types";

export interface FeedRow {
  hasThreadChild: boolean;
  hasThreadParent: boolean;
  post: FeedPost;
}

// Virtualize individual posts, while retaining the thread's order and rails.
// A thread can span many screens; treating it as one cell mounts every reply
// and marks all of its media visible when only one part is on screen.
export function flattenFeedRows(groups: FeedThreadGroup[]): FeedRow[] {
  return groups.flatMap((group) =>
    group.posts.map((post, index) => ({
      hasThreadChild: index < group.posts.length - 1,
      hasThreadParent: index > 0,
      post,
    }))
  );
}

// A new reply must not drag its existing parent/thread out of the reader's place.
// Group new arrivals separately until an explicit refresh establishes new ordering.
export function incomingFeedRows(
  posts: FeedPost[],
  incomingIds: ReadonlySet<string>
): FeedRow[] {
  if (incomingIds.size === 0) {
    return flattenFeedRows(groupPostsIntoThreads(posts));
  }
  return flattenFeedRows([
    ...groupPostsIntoThreads(posts.filter((post) => incomingIds.has(post.id))),
    ...groupPostsIntoThreads(posts.filter((post) => !incomingIds.has(post.id))),
  ]);
}

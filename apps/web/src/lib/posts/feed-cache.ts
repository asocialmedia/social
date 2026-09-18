import type { PostsPage } from "@asm/db";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

// How long feed pages survive in cache without an observer. Outlives a
// post/media detour so coming back renders the cached pages instantly (no
// skeleton, no top-of-feed reset) instead of refetching.
export const FEED_CACHE_RETENTION_MS = 30 * 60 * 1000;

// Shared cache lifecycle for the timeline feeds (home tabs, following, gusts).
// staleTime is `Infinity` so time passing - or flipping back and forth between
// tabs - never replaces a cached list on its own; only an explicit
// invalidateQueries (publish, moderation, response) or the first load fetches.
// refetchOnMount stays true so those invalidations are picked up when an
// unmounted tab remounts. New posts from other people surface through the head
// probe in useNewContentProbe instead.
export const FEED_QUERY_BEHAVIOR = {
  gcTime: FEED_CACHE_RETENTION_MS,
  refetchOnMount: true,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: Number.POSITIVE_INFINITY,
} as const;

// A single post is dropped from a rendered feed for one of three reasons:
// it is the detail post this feed is nested under (`excludePostId`), it is
// already shown by a leading segment (`excludeIds`, e.g. a community lead), or
// the viewer dismissed it this session (`dismissedIds`). Centralised so the
// local list, the prop-sync reconciliation, and the cache-sync rebuild can
// never disagree about what belongs on screen.
export interface FeedExclusions {
  dismissedIds?: ReadonlySet<string>;
  excludeIds?: ReadonlySet<string>;
  excludePostId?: string;
}

export function filterFeedPosts<T extends { id: string }>(
  posts: readonly T[],
  exclusions: FeedExclusions = {}
): T[] {
  const { dismissedIds, excludeIds, excludePostId } = exclusions;
  return posts.filter((post) => {
    if (!post) {
      return false;
    }
    if (excludePostId !== undefined && post.id === excludePostId) {
      return false;
    }
    if (excludeIds?.has(post.id)) {
      return false;
    }
    return !dismissedIds?.has(post.id);
  });
}

// Merges freshly-probed posts into the head of an infinite feed cache. Used by
// the "new posts" badge so tapping it reveals content instantly (no refetch
// round-trip, no skeleton) while leaving pagination cursors untouched. Returns
// false when there was nothing new to add.
export function prependPostsToFeedCache(
  queryClient: QueryClient,
  queryKey: QueryKey,
  posts: PostsPage["posts"]
): boolean {
  if (posts.length === 0) {
    return false;
  }

  let added = false;
  queryClient.setQueryData<InfiniteData<PostsPage, string | null>>(
    queryKey,
    (old) => {
      if (!old || old.pages.length === 0) {
        return old;
      }
      const knownIds = new Set(
        old.pages.flatMap((page) => page.posts.map((post) => post.id))
      );
      const fresh = posts.filter((post) => !knownIds.has(post.id));
      if (fresh.length === 0) {
        return old;
      }
      added = true;
      const [firstPage, ...restPages] = old.pages;
      return {
        ...old,
        pages: [
          { ...firstPage, posts: [...fresh, ...firstPage.posts] },
          ...restPages,
        ],
      };
    }
  );
  return added;
}

// Scrolls the nearest scrollable ancestor of `node` back to the top. Feeds live
// inside a shared scroll container rather than owning their own overflow, so
// walking up finds the right element on both the home tabs and the post page.
export function scrollFeedToTop(node: HTMLElement | null): void {
  let current = node;
  while (current) {
    if (current.scrollHeight > current.clientHeight) {
      current.scrollTo({ behavior: "smooth", top: 0 });
      return;
    }
    current = current.parentElement;
  }
}

// Per-tab feed page cache, mirroring web's React Query feed behavior
// (feed-cache.ts) without the dependency: entries live 30 minutes
// (FEED_CACHE_RETENTION_MS, survives a detail detour), never go stale on
// their own (web staleTime: Infinity - only explicit invalidation refetches),
// and refresh-on-mount picks up invalidations. Pure and unit-testable.
import type { FeedFilter, FeedPost } from "../lib/feed-types";
import { filterFeedPosts, normalizePostsData } from "../lib/feed-types";

// Matches web FEED_CACHE_RETENTION_MS (feed gcTime).
export const FEED_CACHE_RETENTION_MS = 30 * 60 * 1000;

export interface TabFeed {
  cursor: string | null;
  error: string | null;
  fetchedAt: number;
  hasMore: boolean;
  pages: FeedPost[][];
  stale: boolean;
  status:
    | "error"
    | "idle"
    | "loading"
    | "loading-more"
    | "refreshing"
    | "success";
}

function emptyFeed(): TabFeed {
  return {
    cursor: null,
    error: null,
    fetchedAt: 0,
    hasMore: true,
    pages: [],
    stale: true,
    status: "idle",
  };
}

// Flattens pages into a unique post list, like web flattenUniquePosts: rank
// shifts between refetches can land the same post on two pages.
export function flattenUniquePosts(pages: FeedPost[][]): FeedPost[] {
  const list = pages.flat().filter(Boolean);
  return [...new Map(list.map((post) => [post.id, post])).values()];
}

// Prepends probed posts to page one only (cursors untouched), deduped by id.
// No-op when there is nothing new or no cache entry, like web
// prependPostsToFeedCache.
export function prependPosts(
  pages: FeedPost[][],
  fresh: FeedPost[]
): { added: boolean; pages: FeedPost[][] } {
  if (fresh.length === 0 || pages.length === 0) {
    return { added: false, pages };
  }
  const known = new Set(pages.flat().map((post) => post.id));
  const unseen = fresh.filter((post) => post && !known.has(post.id));
  if (unseen.length === 0) {
    return { added: false, pages };
  }
  const [first, ...rest] = pages;
  return { added: true, pages: [[...unseen, ...(first ?? [])], ...rest] };
}

export class FeedCache {
  private listeners = new Set<() => void>();
  private now: () => number;
  private tabs = new Map<string, TabFeed>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Subscribe to cache writes (view-count reconciles included). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private prune(): void {
    for (const [key, feed] of this.tabs) {
      if (this.now() - feed.fetchedAt > FEED_CACHE_RETENTION_MS) {
        this.tabs.delete(key);
      }
    }
  }

  get(key: string): TabFeed {
    this.prune();
    return this.tabs.get(key) ?? emptyFeed();
  }

  set(key: string, feed: TabFeed): void {
    this.tabs.set(key, { ...feed, fetchedAt: this.now() });
  }

  patch(key: string, partial: Partial<TabFeed>): TabFeed {
    const next = { ...this.get(key), ...partial, fetchedAt: this.now() };
    this.tabs.set(key, next);
    this.notify();
    return next;
  }

  /** Applies normalized page data (filter shared with the list render). */
  applyPage(
    key: string,
    posts: FeedPost[],
    cursor: string | null,
    filter: FeedFilter,
    append: boolean
  ): TabFeed {
    const current = this.get(key);
    const clean = filterFeedPosts(normalizePostsData(posts), filter);
    const pages = append ? [...current.pages, clean] : [clean];
    return this.patch(key, {
      cursor,
      error: null,
      hasMore: cursor !== null,
      pages,
      stale: false,
      status: "success",
    });
  }

  /** Patches one post everywhere it is cached (view-count reconcile). */
  updatePostEverywhere(postId: string, partial: Partial<FeedPost>): void {
    let changed = false;
    for (const [key, feed] of this.tabs) {
      let tabChanged = false;
      const pages = feed.pages.map((page) =>
        page.map((post) => {
          if (post.id !== postId) {
            return post;
          }
          tabChanged = true;
          return { ...post, ...partial };
        })
      );
      if (tabChanged) {
        changed = true;
        this.tabs.set(key, { ...feed, pages });
      }
    }
    if (changed) {
      this.notify();
    }
  }

  /** Marks every tab stale so remounts refetch (publish/moderation paths). */
  invalidateAll(): void {
    for (const [key, feed] of this.tabs) {
      this.tabs.set(key, { ...feed, stale: true });
    }
    this.notify();
  }

  invalidate(key: string): void {
    const feed = this.tabs.get(key);
    if (feed) {
      this.tabs.set(key, { ...feed, stale: true });
      this.notify();
    }
  }

  clear(): void {
    this.tabs.clear();
  }
}

/** Process-wide feed cache used by the hooks. */
export const feedCache = new FeedCache();

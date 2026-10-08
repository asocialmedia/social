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
  pageCursors?: (string | null)[];
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

// A published post belongs at the head of the Latest tab, and the reader should
// land on it rather than wherever they last left that feed. The request is a
// one-shot module signal (not state) because it is a command aimed at whichever
// list is showing, not something a component renders from: only the tab that
// was actually asked for consumes it, so switching to Latest for any other
// reason is untouched.
let pendingFeedTop: string | null = null;
let topRequestVersion = 0;
const topRequestListeners = new Set<() => void>();

// Asks the named feed to scroll to the top the next time it is shown.
export function requestFeedTop(variant: string): void {
  pendingFeedTop = variant;
  topRequestVersion += 1;
  for (const listener of topRequestListeners) {
    listener();
  }
}

// Subscribing is what makes the request work when the feed is ALREADY the one
// being shown: a tab switch alone would not re-run the list's effect, so
// publishing from the composer on top of Latest would insert the post without
// ever scrolling to it, and the request would linger to hijack a later visit.
export function subscribeFeedTopRequests(listener: () => void): () => void {
  topRequestListeners.add(listener);
  return () => {
    topRequestListeners.delete(listener);
  };
}

// Claims a pending scroll-to-top for `variant`. Returns true at most once per
// request, so the list that acts on it does not fight a later remount.
export function consumeFeedTop(variant: string): boolean {
  if (pendingFeedTop !== variant) {
    return false;
  }
  pendingFeedTop = null;
  return true;
}

// Drops any pending request, so a stale one cannot hijack a later visit.
export function clearFeedTopRequest(): void {
  pendingFeedTop = null;
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

// Listener sets let lists skip writes that do not touch their tab: a
// view-count reconcile otherwise re-renders every mounted list mid-scroll.
// A null set means "everything changed" (patch/invalidate paths).
export type FeedCacheChangeKeys = ReadonlySet<string> | null;

export class FeedCache {
  private listeners = new Set<(changedKeys?: FeedCacheChangeKeys) => void>();
  private now: () => number;
  private tabs = new Map<string, TabFeed>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  // Subscribe to cache writes (view-count reconciles included).
  subscribe(listener: (changedKeys?: FeedCacheChangeKeys) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(changedKeys: FeedCacheChangeKeys = null): void {
    for (const listener of this.listeners) {
      listener(changedKeys);
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

  // Live keys for snapshotting. Prunes first so expired tabs never persist.
  keys(): string[] {
    this.prune();
    return [...this.tabs.keys()];
  }

  set(key: string, feed: TabFeed): void {
    this.tabs.set(key, feed);
    this.notify(new Set([key]));
  }

  patch(key: string, partial: Partial<TabFeed>): TabFeed {
    const next = { ...this.get(key), ...partial, fetchedAt: this.now() };
    this.tabs.set(key, next);
    this.notify(new Set([key]));
    try {
      scheduleFeedPersist();
    } catch {
      // Persistence is best-effort.
    }
    return next;
  }

  // Applies normalized page data (filter shared with the list render).
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
    const pageCursors = append
      ? [...(current.pageCursors ?? current.pages.map(() => null)), cursor]
      : [cursor];
    return this.patch(key, {
      cursor,
      error: null,
      hasMore: cursor !== null,
      pageCursors,
      pages,
      stale: false,
      status: "success",
    });
  }

  // Puts a just-published post at the head of a tab so it is on screen the
  // moment the reader lands there, instead of after a refetch round-trip.
  //
  // Two cases, because the tab may never have been opened: a tab that already
  // has pages gets the post prepended to page one with the cursor untouched
  // (the same shape the new-content pill uses), and a tab with nothing cached
  // gets a one-page entry marked stale, so it renders the post at once and then
  // refetches the real first page when it mounts.
  showPublishedPost(key: string, post: FeedPost): void {
    const current = this.get(key);
    if (current.pages.length === 0) {
      this.patch(key, {
        cursor: null,
        error: null,
        hasMore: false,
        pages: [[post]],
        stale: true,
        status: "success",
      });
      return;
    }
    const { added, pages } = prependPosts(current.pages, [post]);
    if (added) {
      this.patch(key, { pages });
    }
  }

  // Patches one post everywhere it is cached (view-count reconcile).
  updatePostEverywhere(postId: string, partial: Partial<FeedPost>): void {
    this.updatePostsEverywhere(new Map([[postId, partial]]));
  }

  // Reconcile a server batch in one pass and publish once. Unchanged rows and
  // pages keep their identity, including repeated view counts from the server.
  updatePostsEverywhere(updates: ReadonlyMap<string, Partial<FeedPost>>): void {
    const changedKeys = new Set<string>();
    for (const [key, feed] of this.tabs) {
      let tabChanged = false;
      const pages = feed.pages.map((page) => {
        let pageChanged = false;
        const nextPage = page.map((post) => {
          const partial = updates.get(post.id);
          if (
            !partial ||
            Object.entries(partial).every(
              ([field, value]) => post[field as keyof FeedPost] === value
            )
          ) {
            return post;
          }
          pageChanged = true;
          tabChanged = true;
          return { ...post, ...partial };
        });
        return pageChanged ? nextPage : page;
      });
      if (tabChanged) {
        changedKeys.add(key);
        this.tabs.set(key, { ...feed, pages });
      }
    }
    if (changedKeys.size > 0) {
      this.notify(changedKeys);
    }
  }

  // Marks every tab stale so remounts refetch (publish/moderation paths).
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
      this.notify(new Set([key]));
    }
  }

  clear(): void {
    this.tabs.clear();
  }
}

// Process-wide feed cache used by the hooks.
export const feedCache = new FeedCache();

// Persistent snapshot shape for disk. Only success entries with pages are
// stored, capped to the first two pages per tab so the file stays small and
// hydration is instant. Loading states are never persisted.
export type FeedPersistEntry = Pick<
  TabFeed,
  "cursor" | "fetchedAt" | "hasMore" | "pages" | "pageCursors"
>;
export const FEED_PERSIST_NAME = "feed-cache-v1";
export const FEED_PERSIST_MAX_TABS = 8;
export const FEED_PERSIST_MAX_PAGES = 2;
export function persistFeedEntry(entry: TabFeed): FeedPersistEntry {
  // Legacy entries have no page boundaries. Keep their complete pages rather
  // than pairing a truncated head with a later cursor and skipping content.
  const pages = entry.pageCursors
    ? entry.pages.slice(0, FEED_PERSIST_MAX_PAGES)
    : entry.pages;
  const pageCursors = entry.pageCursors?.slice(0, pages.length);
  const cursor = pageCursors
    ? (pageCursors[pages.length - 1] ?? null)
    : entry.cursor;
  const truncated = pages.length < entry.pages.length;
  return {
    cursor,
    fetchedAt: entry.fetchedAt,
    hasMore: truncated || entry.hasMore,
    pageCursors,
    pages,
  };
}
export function feedCacheToSnapshot(
  now: number = Date.now()
): Record<string, FeedPersistEntry> {
  const out: Record<string, FeedPersistEntry> = {};
  // Access via get() would prune; read the live map through a fresh instance
  // is not possible, so snapshot only keys that still read fresh.
  // The cache below exposes keys() for this purpose.
  for (const key of feedCache.keys()) {
    const entry = feedCache.get(key);
    if (entry.status !== "success" || entry.pages.length === 0) {
      continue;
    }
    if (now - entry.fetchedAt > FEED_CACHE_RETENTION_MS) {
      continue;
    }
    out[key] = persistFeedEntry(entry);
    if (Object.keys(out).length >= FEED_PERSIST_MAX_TABS) {
      break;
    }
  }
  return out;
}
// Restores persisted tabs as success entries with stale-while-revalidate:
// rows paint instantly, and tabs older than a minute refetch in the
// background on mount (use-feed treats stale as refetch-worthy but keeps
// showing the list, never the skeleton). Expired entries are skipped.
const HYDRATED_STALE_AFTER_MS = 60 * 1000;
export function restoreFeedCache(
  snapshot: Record<string, FeedPersistEntry>
): number {
  let restored = 0;
  const now = Date.now();
  for (const [key, entry] of Object.entries(snapshot)) {
    if (!entry || !Array.isArray(entry.pages) || entry.pages.length === 0) {
      continue;
    }
    if (
      !Number.isFinite(entry.fetchedAt) ||
      now - entry.fetchedAt > FEED_CACHE_RETENTION_MS
    ) {
      continue;
    }
    const current = feedCache.get(key);
    if (current.pages.length > 0 || current.status !== "idle") {
      continue;
    }
    // Old snapshots may contain a cursor beyond their saved pages.
    const backgroundRefresh =
      !entry.pageCursors || now - entry.fetchedAt > HYDRATED_STALE_AFTER_MS;
    feedCache.set(key, {
      cursor: typeof entry.cursor === "string" ? entry.cursor : null,
      error: null,
      fetchedAt: entry.fetchedAt,
      hasMore: entry.hasMore !== false,
      pageCursors: entry.pageCursors,
      pages: entry.pages,
      stale: backgroundRefresh,
      status: "success",
    });
    restored += 1;
  }
  return restored;
}
// Debounced file persist. Called after cache writes; coalesces bursts of
// view-count reconciles into one file write.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistHydrated = false;
export function markPersistHydrated(): void {
  persistHydrated = true;
}
export function scheduleFeedPersist(): void {
  if (!persistHydrated) {
    return;
  }
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void (async () => {
      try {
        const { writeSnapshot } = await import("@/lib/persistent-file");
        const tabs = feedCacheToSnapshot();
        await writeSnapshot<Record<string, FeedPersistEntry>>(
          FEED_PERSIST_NAME,
          {
            entries: { tabs: { data: tabs, fetchedAt: Date.now() } },
            version: 1,
          }
        );
      } catch {
        // Persistence must never break the feed.
      }
    })();
  }, 800);
}
// Hydrates the in-memory cache from disk once per launch. Returns restored
// tab count. Stale-while-revalidate: callers render cached rows instantly and
// still refetch in the background when stale.
let hydrationRequest: Promise<number> | null = null;
export function hydrateFeedCache(): Promise<number> {
  hydrationRequest ??= readFeedCacheFromDisk();
  return hydrationRequest;
}

async function readFeedCacheFromDisk(): Promise<number> {
  try {
    const { readSnapshot } = await import("@/lib/persistent-file");
    const snap =
      await readSnapshot<Record<string, FeedPersistEntry>>(FEED_PERSIST_NAME);
    const wrapped = snap.entries["tabs"];
    const data = (wrapped?.data ?? {}) as Record<string, FeedPersistEntry>;
    const count = restoreFeedCache(data);
    markPersistHydrated();
    return count;
  } catch {
    markPersistHydrated();
    return 0;
  }
}

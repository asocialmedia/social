// Per-sort HackerNews page cache, mirroring the Explore cache
// (features/explore/lib/explore-cache.ts): a tab visit reuses its complete page
// chain instead of refetching, a fresh entry renders with no network, and only
// an explicit refresh or expiry reloads it. Kept free of react-native so the
// rules are unit-testable on Node.
import { emptySnapshot, pruneSnapshot } from "@/lib/persistent-cache";
import type { PersistSnapshot } from "@/lib/persistent-cache";

import type { HnSort, HnStory } from "./hackernews-api";

// Matches the feed cache's in-memory retention (30 minutes, survives a detour).
export const HN_CACHE_RETENTION_MS = 30 * 60 * 1000;
// Persisted previews survive a normal next-day launch; their age still forces a
// background refresh on mount.
export const HN_PERSIST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 16;
const PERSIST_MAX_STORIES = 20;

export interface HnPageResult {
  hasMore: boolean;
  page: number;
  rateLimited: boolean;
  stories: HnStory[];
}

export type HnFeedStatus =
  | "error"
  | "idle"
  | "loading"
  | "loading-more"
  | "refreshing"
  | "success";

export interface HnFeedEntry {
  bookmarks: Record<number, boolean>;
  error: string | null;
  fetchedAt: number;
  hasMore: boolean;
  page: number;
  rateLimited: boolean;
  status: HnFeedStatus;
  stories: HnStory[];
}

// Persist only the rows and pagination; transient loading/error UI and the
// bookmark overlay (refetched with the session) do not survive a relaunch.
export interface HnPersistEntry {
  fetchedAt: number;
  hasMore: boolean;
  page: number;
  stories: HnStory[];
}

const EMPTY: HnFeedEntry = {
  bookmarks: {},
  error: null,
  fetchedAt: 0,
  hasMore: true,
  page: 1,
  rateLimited: false,
  status: "idle",
  stories: [],
};

export function hnCacheKey(
  apiBase: string,
  viewerId: string | undefined,
  sort: HnSort,
  search: string
): string {
  return JSON.stringify([apiBase, viewerId ?? "guest", sort, search.trim()]);
}

// Flattens a page append into a unique list: a rank shift between fetches can
// land the same story on two pages.
function mergeUnique(current: HnStory[], next: HnStory[]): HnStory[] {
  const known = new Set(current.map((story) => story.id));
  return [...current, ...next.filter((story) => !known.has(story.id))];
}

export class HnCache {
  private entries = new Map<string, HnFeedEntry>();
  private listeners = new Set<() => void>();
  private offsets = new Map<string, number>();
  private requests = new Map<string, Promise<void>>();
  private generation = 0;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  read = (key: string): HnFeedEntry => this.entries.get(key) ?? EMPTY;

  private write(key: string, entry: HnFeedEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
      this.offsets.delete(oldest);
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  isFresh(key: string): boolean {
    const entry = this.read(key);
    return (
      entry.stories.length > 0 &&
      this.now() - entry.fetchedAt < HN_CACHE_RETENTION_MS
    );
  }

  load(
    key: string,
    fetchPage: () => Promise<HnPageResult>,
    mode: "append" | "initial" | "refresh" = "initial"
  ): Promise<void> {
    const pending = this.requests.get(key);
    if (pending) {
      return pending;
    }
    if (mode === "initial" && this.isFresh(key)) {
      return Promise.resolve();
    }
    const current = this.read(key);
    // A background revalidation of a tab that already has rows keeps its
    // success status so the rows stay put with no loader, exactly like the
    // feed's stale-while-revalidate. A manual refresh shows the pull loader;
    // an empty first load shows the skeleton.
    let opening: HnFeedStatus = "loading";
    if (mode === "append") {
      opening = "loading-more";
    } else if (current.stories.length > 0) {
      opening = mode === "refresh" ? "refreshing" : "success";
    }
    const { generation } = this;
    this.write(key, { ...current, error: null, status: opening });
    const request = (async () => {
      try {
        const page = await fetchPage();
        if (generation !== this.generation) {
          return;
        }
        const previous = this.read(key);
        const stories =
          mode === "append"
            ? mergeUnique(previous.stories, page.stories)
            : page.stories;
        this.write(key, {
          ...previous,
          error: null,
          fetchedAt: mode === "append" ? previous.fetchedAt : this.now(),
          hasMore: page.hasMore,
          page: page.page,
          rateLimited: page.rateLimited,
          status: "success",
          stories,
        });
      } catch (error) {
        if (generation !== this.generation) {
          return;
        }
        this.write(key, {
          ...this.read(key),
          error:
            error instanceof Error
              ? error.message
              : "Couldn't load HackerNews right now.",
          status: "error",
        });
      } finally {
        if (generation === this.generation) {
          this.requests.delete(key);
        }
      }
    })();
    this.requests.set(key, request);
    return request;
  }

  setBookmarks(key: string, bookmarks: Record<number, boolean>): void {
    const entry = this.read(key);
    this.write(key, {
      ...entry,
      bookmarks: { ...entry.bookmarks, ...bookmarks },
    });
  }

  setBookmark(key: string, storyId: number, value: boolean): void {
    const entry = this.read(key);
    this.write(key, {
      ...entry,
      bookmarks: { ...entry.bookmarks, [storyId]: value },
    });
  }

  scrollOffset(key: string): number {
    return this.offsets.get(key) ?? 0;
  }

  setScrollOffset(key: string, offset: number): void {
    this.offsets.set(key, Math.max(0, offset));
  }

  hydrate(snapshot: PersistSnapshot<HnPersistEntry>): void {
    const fresh = pruneSnapshot(
      snapshot,
      this.now(),
      HN_PERSIST_RETENTION_MS,
      MAX_ENTRIES
    );
    for (const [key, entry] of Object.entries(fresh.entries)) {
      if (this.entries.has(key)) {
        continue;
      }
      const { data } = entry;
      if (!data || !Array.isArray(data.stories) || data.stories.length === 0) {
        continue;
      }
      // A restored preview paints as a success entry; the hook treats an entry
      // older than the retention window as refetch-worthy and revalidates it in
      // the background without ever falling back to the skeleton.
      this.write(key, {
        bookmarks: {},
        error: null,
        fetchedAt: entry.fetchedAt,
        hasMore: data.hasMore !== false,
        page: typeof data.page === "number" ? data.page : 1,
        rateLimited: false,
        status: "success",
        stories: data.stories,
      });
    }
  }

  snapshot(): PersistSnapshot<HnPersistEntry> {
    const snapshot = emptySnapshot<HnPersistEntry>();
    for (const [key, entry] of this.entries) {
      if (entry.stories.length === 0) {
        continue;
      }
      snapshot.entries[key] = {
        data: {
          fetchedAt: entry.fetchedAt,
          hasMore: entry.hasMore,
          page: entry.page,
          stories: entry.stories.slice(0, PERSIST_MAX_STORIES),
        },
        fetchedAt: entry.fetchedAt,
      };
    }
    return pruneSnapshot(
      snapshot,
      this.now(),
      HN_PERSIST_RETENTION_MS,
      MAX_ENTRIES
    );
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.offsets.clear();
    this.requests.clear();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const hnCache = new HnCache();

// HackerNews feed state for one sort tab, backed by the per-sort hnCache:
// a warm tab renders its cached rows with no network, only a stale or missing
// entry fetches, and pull-refresh or pagination reloads it. Mirrors the shape
// of use-feed (features/feed/state/use-feed.ts) without React Query.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";

import {
  fetchHnBookmarkStates,
  fetchHnPage,
  setHnBookmark,
} from "../lib/hackernews-api";
import type { HnSort, HnStory } from "../lib/hackernews-api";
import { hnCache, hnCacheKey } from "../lib/hn-cache";
import type { HnFeedEntry } from "../lib/hn-cache";
import { hydrateHnCache } from "../lib/hn-cache-native";

interface UseHnFeedOptions {
  active: boolean;
  enabled: boolean;
  search: string;
  sort: HnSort;
  userId: string | undefined;
}

export interface UseHnFeed {
  bookmarks: Record<number, boolean>;
  error: string | null;
  fetchNext: () => void;
  hasMore: boolean;
  now: number;
  rateLimited: boolean;
  refresh: () => void;
  status: HnFeedEntry["status"];
  stories: HnStory[];
  toggleBookmark: (story: HnStory) => Promise<boolean>;
}

export function useHnFeed({
  active,
  enabled,
  search,
  sort,
  userId,
}: UseHnFeedOptions): UseHnFeed {
  const apiBase = getApiBaseUrl();
  const cacheKey = hnCacheKey(apiBase, userId, sort, search);
  const entry = useSyncExternalStore(hnCache.subscribe, () =>
    hnCache.read(cacheKey)
  );
  // The relative-time clock: stamped once and refreshed only when a load
  // settles, so a scroll tick never re-renders the rows with a new reading.
  const [now, setNow] = useState(() => Date.now());
  // The active tab owns the network; neighbours keep their cached rows but do
  // not refetch or paginate until they are shown.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  // A preloaded neighbour keeps its rows but not a fresh clock, so re-stamp the
  // relative times the moment the tab is shown.
  useEffect(() => {
    if (active) {
      // oxlint-disable-next-line react/set-state-in-effect -- re-stamp the relative-time clock on show
      setNow(Date.now());
    }
  }, [active]);

  // The bookmark overlay is a second read, meaningful only with a session. It
  // runs for the visible tab whenever the rows change (first load, refresh,
  // append), so a preloaded neighbour picks its bookmarks up on show without a
  // page refetch. Keyed on the stories array reference, so a bookmark write -
  // which keeps that reference - never re-triggers it.
  const storiesRef = useRef<HnStory[] | null>(null);
  useEffect(() => {
    if (!active || !userId || entry.stories.length === 0) {
      return;
    }
    if (storiesRef.current === entry.stories) {
      return;
    }
    storiesRef.current = entry.stories;
    void (async () => {
      const states = await fetchHnBookmarkStates(
        entry.stories.map((story) => story.id),
        { apiBase, cookie: await authClient.getCookie() }
      );
      if (activeRef.current) {
        hnCache.setBookmarks(cacheKey, states);
      }
    })();
  }, [active, apiBase, cacheKey, entry.stories, userId]);

  const runLoad = useCallback(
    async (mode: "append" | "initial" | "refresh") => {
      const current = hnCache.read(cacheKey);
      const cookie = await authClient.getCookie();
      const options = { apiBase, cookie };
      const nextPage = mode === "append" ? current.page + 1 : 1;
      await hnCache.load(
        cacheKey,
        async () => {
          const page = await fetchHnPage(
            { page: nextPage, search, sort },
            options
          );
          return {
            hasMore: page.hasMore,
            page: nextPage,
            rateLimited: page.rateLimited,
            stories: page.stories,
          };
        },
        mode
      );
      const failure = hnCache.read(cacheKey).error;
      if (failure) {
        logWarn("hackernews.load_failed", { reason: failure });
      }
      if (!activeRef.current) {
        return;
      }
      setNow(Date.now());
    },
    [apiBase, cacheKey, search, sort]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await hydrateHnCache();
      if (cancelled) {
        return;
      }
      const current = hnCache.read(cacheKey);
      if (current.status === "idle" || !hnCache.isFresh(cacheKey)) {
        void runLoad("initial");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, runLoad]);

  const refresh = useCallback(() => {
    void runLoad("refresh");
  }, [runLoad]);

  const fetchNext = useCallback(() => {
    if (!activeRef.current) {
      return;
    }
    const current = hnCache.read(cacheKey);
    if (current.status !== "success" || !current.hasMore) {
      return;
    }
    void runLoad("append");
  }, [cacheKey, runLoad]);

  const toggleBookmark = useCallback(
    async (story: HnStory): Promise<boolean> => {
      const next = !(hnCache.read(cacheKey).bookmarks[story.id] ?? false);
      hnCache.setBookmark(cacheKey, story.id, next);
      try {
        const ok = await setHnBookmark(story.id, next, {
          apiBase,
          cookie: await authClient.getCookie(),
        });
        if (!ok) {
          hnCache.setBookmark(cacheKey, story.id, !next);
          return false;
        }
        return true;
      } catch (error) {
        hnCache.setBookmark(cacheKey, story.id, !next);
        logWarn("hackernews.bookmark_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
    [apiBase, cacheKey]
  );

  return {
    bookmarks: entry.bookmarks,
    error: entry.error,
    fetchNext,
    hasMore: entry.hasMore,
    now,
    rateLimited: entry.rateLimited,
    refresh,
    status: entry.status,
    stories: entry.stories,
    toggleBookmark,
  };
}

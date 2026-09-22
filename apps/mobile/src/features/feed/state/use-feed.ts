// Per-tab feed data hook: infinite cursor pages, pull-refresh, the
// new-content head probe, and session dismissals with undo. Mirrors web's
// HomeFeed + useNewContentProbe behavior without React Query: fresh cache
// entries render with no network (staleTime Infinity), only explicit
// invalidation refetches, and new posts arrive through the head probe.
//
// Dismissal ("Not interested") hides by id for the session; the removed post
// data is kept in a ref so Undo restores it without a refetch, exactly like
// web's removedPostsRef.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";

import type { FeedVariant } from "../lib/feed-api";
import { fetchFeedHead, fetchFeedPage } from "../lib/feed-api";
import type { FeedPost } from "../lib/feed-types";
import {
  filterFeedPosts,
  findUnseenItems,
  normalizePostsData,
  sortPostsNewest,
} from "../lib/feed-types";
import { feedCache, flattenUniquePosts, prependPosts } from "./feed-store";

// Head probe interval, mirroring web useNewContentProbe.
const PROBE_INTERVAL_MS = 45_000;

export type FeedStatus =
  | "error"
  | "idle"
  | "loading"
  | "loading-more"
  | "refreshing"
  | "success";

interface UseFeedTabOptions {
  enabled: boolean;
  userId: string | undefined;
  variant: FeedVariant;
}

export function useFeedTab({ enabled, userId, variant }: UseFeedTabOptions): {
  clearNewItems: () => void;
  dismissPost: (postId: string) => void;
  error: string | null;
  fetchNext: () => void;
  hasMore: boolean;
  newItems: FeedPost[];
  posts: FeedPost[];
  refresh: () => void;
  showNewPosts: () => void;
  status: FeedStatus;
  undoDismiss: (postId: string) => void;
} {
  const cacheKey = `${variant}:${userId ?? "guest"}`;
  const [, setTick] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [newItems, setNewItems] = useState<FeedPost[]>([]);
  const removedPostsRef = useRef(new Map<string, FeedPost>());
  const fetchingRef = useRef(false);

  // Re-read from the module cache every render: patch() always stores a
  // fresh object identity, so useMemo below recomputes exactly when the
  // cache changed. setTick only schedules the re-render.
  const entry = feedCache.get(cacheKey);
  const { error, hasMore, pages, status } = entry;

  // External cache writes (view-count reconciles, invalidations from other
  // tabs) must also rerender the list.
  useEffect(() => feedCache.subscribe(() => setTick((value) => value + 1)), []);

  const runFetch = useCallback(
    async (mode: "append" | "replace", headCursor: string | null) => {
      if (fetchingRef.current) {
        return;
      }
      fetchingRef.current = true;
      // Replacement over existing pages is a refresh; the very first load
      // (no pages yet) stays "loading" so the skeleton renders.
      let opening: "loading" | "loading-more" | "refreshing" = "refreshing";
      if (mode === "append") {
        opening = "loading-more";
      } else if (feedCache.get(cacheKey).pages.length === 0) {
        opening = "loading";
      }
      feedCache.patch(cacheKey, {
        error: null,
        status: opening,
      });
      setTick((value) => value + 1);
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const page = await fetchFeedPage(variant, headCursor, {
          apiBase,
          cookie,
        });
        feedCache.applyPage(
          cacheKey,
          page.posts,
          page.nextCursor,
          { dismissedIds: undefined },
          mode === "append"
        );
        fetchingRef.current = false;
        setTick((value) => value + 1);
      } catch (fetchError) {
        feedCache.patch(cacheKey, {
          error:
            fetchError instanceof Error
              ? fetchError.message
              : "Couldn't load posts.",
          status: "error",
        });
        logWarn("feed.fetch_failed", {
          reason:
            fetchError instanceof Error
              ? fetchError.message
              : String(fetchError),
          variant,
        });
        // No finally: the React Compiler rejects try/finally, so the reset
        // is written out on both paths (same reason as update-gate.ts).
        fetchingRef.current = false;
        setTick((value) => value + 1);
      }
    },
    [cacheKey, variant]
  );

  // First page: cached entries render as-is (staleTime Infinity); missing or
  // invalidated entries fetch. refetchOnMount picks up invalidations.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const current = feedCache.get(cacheKey);
    if (current.status === "idle" || current.stale) {
      // oxlint-disable-next-line react/set-state-in-effect -- mount-fill: idle/invalidated tabs enter loading here; the fetch below settles it
      feedCache.patch(cacheKey, { error: null, status: "loading" });
      // oxlint-disable-next-line react/set-state-in-effect -- mount-fill must kick off the first fetch here; steady state is cache-driven
      void runFetch("replace", null);
    }
    // Runs on mount/tab-switch/enable; runFetch is stable per cacheKey.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- intentional mount-fill keyed by cacheKey via runFetch identity
  }, [cacheKey, enabled, runFetch]);

  const fetchNext = useCallback(() => {
    const current = feedCache.get(cacheKey);
    if (!enabled || current.status === "loading-more" || !current.hasMore) {
      return;
    }
    if (current.pages.length === 0) {
      void runFetch("replace", null);
      return;
    }
    void runFetch("append", current.cursor);
  }, [cacheKey, enabled, runFetch]);

  const refresh = useCallback(() => {
    if (!enabled) {
      return;
    }
    feedCache.invalidate(cacheKey);
    void runFetch("replace", null);
  }, [cacheKey, enabled, runFetch]);

  // Head-only probe: new posts collect in newItems without moving the list,
  // exactly like web. Probes on mount and every 45s; skips while the list is
  // empty; swallows fetch errors.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const probe = async () => {
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const fresh = normalizePostsData(
          await fetchFeedHead(variant, { apiBase, cookie })
        );
        if (cancelled || fresh.length === 0) {
          return;
        }
        const known = new Set(
          flattenUniquePosts(feedCache.get(cacheKey).pages).map(
            (post) => post.id
          )
        );
        if (known.size === 0) {
          return;
        }
        const unseen = findUnseenItems(fresh, known);
        if (!cancelled && unseen.length > 0) {
          // oxlint-disable-next-line react/set-state-in-effect -- probed posts collect asynchronously; nothing to derive during render
          setNewItems(unseen);
        }
      } catch {
        // Probe failures are silent by design (web swallows them too).
      }
    };
    void probe();
    const timer = setInterval(() => {
      void probe();
    }, PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cacheKey, enabled, variant]);

  const clearNewItems = useCallback(() => {
    setNewItems([]);
  }, []);

  const showNewPosts = useCallback(() => {
    setNewItems((current) => {
      if (current.length > 0) {
        const entryNow = feedCache.get(cacheKey);
        const { added, pages: nextPages } = prependPosts(
          entryNow.pages,
          current
        );
        if (added) {
          feedCache.patch(cacheKey, { pages: nextPages });
          setTick((value) => value + 1);
        }
      }
      return [];
    });
  }, [cacheKey]);

  const dismissPost = useCallback(
    (postId: string) => {
      const entryNow = feedCache.get(cacheKey);
      const removed = flattenUniquePosts(entryNow.pages).find(
        (post) => post.id === postId
      );
      if (removed) {
        removedPostsRef.current.set(postId, removed);
      }
      setDismissedIds((current) => {
        if (current.has(postId)) {
          return current;
        }
        return new Set([...current, postId]);
      });
    },
    [cacheKey]
  );

  const undoDismiss = useCallback((postId: string) => {
    removedPostsRef.current.delete(postId);
    setDismissedIds((current) => {
      if (!current.has(postId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(postId);
      return next;
    });
  }, []);

  const posts = useMemo(() => {
    const flat = filterFeedPosts(flattenUniquePosts(pages), {
      dismissedIds,
    });
    // Latest is chronological client-side; ranked variants keep server order.
    return variant === "latest" ? sortPostsNewest(flat) : flat;
  }, [dismissedIds, pages, variant]);

  return {
    clearNewItems,
    dismissPost,
    error,
    fetchNext,
    hasMore,
    newItems,
    posts,
    refresh,
    showNewPosts,
    status,
    undoDismiss,
  };
}

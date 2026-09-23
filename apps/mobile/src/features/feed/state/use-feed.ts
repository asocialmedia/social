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
  // The in-flight cache key: a session upgrade mid-fetch (guest key to user
  // key) must not swallow the second fetch, so the guard is per key rather
  // than a single boolean.
  const inflightKey = useRef<string | null>(null);
  // The key that currently owns this hook: a stale replace that settles
  // after disable or a guest-to-user re-key must not start a probe for an
  // inactive key (it would stop the live probe and leak wrong-feed items
  // into newItems).
  const activeKeyRef = useRef<string | null>(null);

  // Re-read from the module cache every render: patch() always stores a
  // fresh object identity, so useMemo below recomputes exactly when the
  // cache changed. setTick only schedules the re-render.
  const entry = feedCache.get(cacheKey);
  const { error, hasMore, pages, status } = entry;

  // External cache writes (view-count reconciles, invalidations from other
  // tabs) must also rerender the list.
  useEffect(() => feedCache.subscribe(() => setTick((value) => value + 1)), []);

  // Head-only probe: new posts collect in newItems without moving the list,
  // exactly like web. Starts from the mount fill and from fetch settles,
  // never from an effect watching cache pages (the Compiler rejects that
  // dep). Probes immediately and every 45s; swallows fetch errors.
  const probeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const probeKey = useRef<string | null>(null);
  const probeCancel = useRef<(() => void) | null>(null);

  const stopProbe = useCallback(() => {
    probeCancel.current?.();
    probeCancel.current = null;
    if (probeTimer.current !== null) {
      clearInterval(probeTimer.current);
      probeTimer.current = null;
    }
    probeKey.current = null;
  }, []);

  const startProbe = useCallback(
    (key: string) => {
      if (probeTimer.current !== null && probeKey.current === key) {
        return;
      }
      stopProbe();
      let cancelled = false;
      probeCancel.current = () => {
        cancelled = true;
      };
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
            flattenUniquePosts(feedCache.get(key).pages).map((post) => post.id)
          );
          if (known.size === 0) {
            return;
          }
          const unseen = findUnseenItems(fresh, known);
          if (!cancelled && unseen.length > 0) {
            setNewItems(unseen);
          }
        } catch {
          // Probe failures are silent by design (web swallows them too).
        }
      };
      probeKey.current = key;
      void probe();
      probeTimer.current = setInterval(() => {
        void probe();
      }, PROBE_INTERVAL_MS);
    },
    [stopProbe, variant]
  );

  const runFetch = useCallback(
    async (mode: "append" | "replace", headCursor: string | null) => {
      if (inflightKey.current === cacheKey) {
        return;
      }
      inflightKey.current = cacheKey;
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
        // First paint landed: the head probe may start now (it never races
        // the first page on cold start). Only when this replace still owns
        // the active key; a stale guest fetch settling after a re-key must
        // not hijack the live probe.
        if (mode === "replace" && activeKeyRef.current === cacheKey) {
          startProbe(cacheKey);
        }
        if (inflightKey.current === cacheKey) {
          inflightKey.current = null;
        }
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
        if (inflightKey.current === cacheKey) {
          inflightKey.current = null;
        }
        setTick((value) => value + 1);
      }
    },
    [cacheKey, startProbe, variant]
  );

  // First page: cached entries render as-is (staleTime Infinity); missing or
  // invalidated entries fetch. refetchOnMount picks up invalidations. Tabs
  // with content already cached resume their probe; empty tabs probe once
  // their first page lands (see runFetch).
  useEffect(() => {
    if (!enabled) {
      activeKeyRef.current = null;
      stopProbe();
      return;
    }
    activeKeyRef.current = cacheKey;
    // Key-specific local state must not leak across a guest-to-user re-key:
    // stale newItems would insert the old feed into the new cache.
    // oxlint-disable-next-line react/set-state-in-effect -- re-key resets the banner; steady state is cache-driven
    setNewItems([]);
    const current = feedCache.get(cacheKey);
    if (current.status === "idle" || current.stale) {
      // oxlint-disable-next-line react/set-state-in-effect -- mount-fill: idle/invalidated tabs enter loading here; the fetch below settles it
      feedCache.patch(cacheKey, { error: null, status: "loading" });
      // oxlint-disable-next-line react/set-state-in-effect -- mount-fill must kick off the first fetch here; steady state is cache-driven
      void runFetch("replace", null);
    } else if (current.pages.length > 0) {
      startProbe(cacheKey);
    }
    return () => {
      if (activeKeyRef.current === cacheKey) {
        activeKeyRef.current = null;
      }
      stopProbe();
    };
    // Runs on mount/tab-switch/enable; runFetch is stable per cacheKey.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- intentional mount-fill keyed by cacheKey via runFetch identity
  }, [cacheKey, enabled, runFetch, stopProbe, startProbe]);

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

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
import { createExpoPoller } from "@/lib/expo-poller";
import { logWarn } from "@/lib/telemetry";

import type { FeedVariant } from "../lib/feed-api";
import {
  feedHeadIdIsChangeSignal,
  fetchFeedHead,
  fetchFeedHeadId,
  fetchFeedPage,
  isRankedFeed,
} from "../lib/feed-api";
import type { FeedPost } from "../lib/feed-types";
import {
  filterFeedPosts,
  findUnseenItems,
  findUnseenRankedItems,
  normalizePostsData,
  sortPostsNewest,
} from "../lib/feed-types";
import {
  feedCache,
  flattenUniquePosts,
  prependPosts,
  hydrateFeedCache,
  reconcileFeedHead,
  feedFetchStatus,
} from "./feed-store";

// Head probe interval, mirroring web useNewContentProbe.
const PROBE_INTERVAL_MS = 20_000;

export type FeedStatus =
  | "error"
  | "idle"
  | "loading"
  | "loading-more"
  | "refreshing"
  | "success";

interface UseFeedTabOptions {
  active?: boolean;
  enabled: boolean;
  userId: string | undefined;
  variant: FeedVariant;
}

export function useFeedTab({
  active: activeOverride,
  enabled,
  userId,
  variant,
}: UseFeedTabOptions): {
  clearNewItems: () => void;
  incomingIds: ReadonlySet<string>;
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
  const active = activeOverride ?? enabled;
  const cacheKey = `${variant}:${userId ?? "guest"}`;
  const [, setTick] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [newItems, setNewItems] = useState<FeedPost[]>([]);
  const [incomingIds, setIncomingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
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
  // tabs) must also rerender the list. Keyed writes that miss this tab are
  // skipped: a reconcile for another tab must not re-render this list
  // mid-scroll.
  useEffect(
    () =>
      feedCache.subscribe((changedKeys) => {
        if (!changedKeys || changedKeys.has(cacheKey)) {
          setTick((value) => value + 1);
        }
      }),
    [cacheKey]
  );

  // Load new rows above the retained feed; native anchoring preserves the reader.
  // Only the foreground tab probes, with a cheap head-id check on chronological feeds.
  const pollerRef = useRef<ReturnType<typeof createExpoPoller> | null>(null);
  const probeKey = useRef<string | null>(null);
  const probeCancel = useRef<(() => void) | null>(null);

  const stopProbe = useCallback(() => {
    probeCancel.current?.();
    probeCancel.current = null;
    pollerRef.current?.stop();
    pollerRef.current = null;
    probeKey.current = null;
  }, []);

  const startProbe = useCallback(
    (key: string) => {
      if (pollerRef.current && probeKey.current === key) {
        return;
      }
      stopProbe();
      let cancelled = false;
      probeCancel.current = () => {
        cancelled = true;
      };
      const probe = async () => {
        try {
          const before = feedCache.get(key);
          if (before.status !== "success" && before.status !== "error") {
            return;
          }
          const apiBase = getApiBaseUrl();
          const cookie = await authClient.getCookie();
          const options = { apiBase, cookie };
          const known = new Set(
            flattenUniquePosts(feedCache.get(key).pages).map((post) => post.id)
          );
          if (known.size === 0) {
            const current = feedCache.get(key);
            const page = await fetchFeedPage(variant, null, options);
            if (
              !cancelled &&
              activeKeyRef.current === key &&
              feedCache.get(key) === current
            ) {
              feedCache.applyPage(key, page.posts, page.nextCursor, {}, false);
            }
            return;
          }
          // Cheap first, and only where it is sound: one row answers "did
          // anything arrive?" on a recency-ordered feed, where a post published
          // now is always the top row. The full head page - twenty
          // viewer-resolved posts plus a view-count read - is only fetched once
          // that row says something new, which for an idle screen is almost
          // never. A ranked feed skips the shortcut and pays for the page: its
          // new post is not obliged to land at the top, so "same top id" there
          // means nothing and the page has to be diffed as a whole.
          if (feedHeadIdIsChangeSignal(variant)) {
            const headId = await fetchFeedHeadId(variant, options);
            if (cancelled || !headId || known.has(headId)) {
              return;
            }
          }
          const fresh = normalizePostsData(
            await fetchFeedHead(variant, options)
          );
          if (cancelled || activeKeyRef.current !== key) {
            return;
          }
          const current = feedCache.get(key);
          if (current.status !== "success" && current.status !== "error") {
            return;
          }
          const currentKnown = new Set(
            flattenUniquePosts(current.pages).map((post) => post.id)
          );
          const unseen = isRankedFeed(variant)
            ? findUnseenRankedItems(fresh, currentKnown)
            : findUnseenItems(fresh, currentKnown);
          if (!cancelled && unseen.length > 0) {
            const next = prependPosts(current.pages, unseen);
            if (next.added) {
              feedCache.patch(key, { pages: next.pages });
              setIncomingIds(
                (ids) => new Set([...ids, ...unseen.map((post) => post.id)])
              );
              setNewItems((pending) => flattenUniquePosts([unseen, pending]));
            }
          }
        } catch {
          // Probe failures are silent by design (web swallows them too).
        }
      };
      probeKey.current = key;
      pollerRef.current = createExpoPoller({
        intervalMs: PROBE_INTERVAL_MS,
        onPoll: probe,
      });
      pollerRef.current.start();
    },
    [stopProbe, variant]
  );

  const runFetch = useCallback(
    async (
      mode: "append" | "replace",
      headCursor: string | null,
      manual = false
    ) => {
      if (inflightKey.current === cacheKey) {
        return;
      }
      inflightKey.current = cacheKey;
      const opening = feedFetchStatus(
        mode,
        feedCache.get(cacheKey).pages.length > 0,
        manual
      );
      feedCache.patch(cacheKey, {
        error: null,
        status: opening,
      });
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const page = await fetchFeedPage(variant, headCursor, {
          apiBase,
          cookie,
        });
        const current = feedCache.get(cacheKey);
        if (mode === "replace" && !manual && current.pages.length > 0) {
          feedCache.patch(cacheKey, {
            error: null,
            fetchedAt: Date.now(),
            pages: reconcileFeedHead(
              current.pages,
              normalizePostsData(page.posts)
            ),
            stale: false,
            status: "success",
          });
        } else {
          feedCache.applyPage(
            cacheKey,
            page.posts,
            page.nextCursor,
            { dismissedIds: undefined },
            mode === "append"
          );
        }
        // First paint landed: the head probe may start now (it never races
        // the first page on cold start). Only when this replace still owns
        // the active key; a stale guest fetch settling after a re-key must
        // not hijack the live probe.
        if (active && mode === "replace" && activeKeyRef.current === cacheKey) {
          startProbe(cacheKey);
        }
        if (inflightKey.current === cacheKey) {
          inflightKey.current = null;
        }
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
        // Empty feeds that failed offline still need a foreground/network recovery path.
        if (active && activeKeyRef.current === cacheKey) {
          startProbe(cacheKey);
        }
      }
    },
    [active, cacheKey, startProbe, variant]
  );

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- new-content rows belong to one account/feed cache key
    setNewItems([]);
    // oxlint-disable-next-line react/set-state-in-effect -- incoming thread grouping belongs to one feed/account
    setIncomingIds(new Set());
    // oxlint-disable-next-line react/set-state-in-effect -- dismissals are scoped to one account/feed
    setDismissedIds(new Set());
    removedPostsRef.current.clear();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- these local rows belong to the cache key, not focus/enabled state
  }, [cacheKey]);

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
    activeKeyRef.current = active ? cacheKey : null;
    let cancelled = false;
    void (async () => {
      // Disk hydration owns the first cache fill. Starting the network first
      // meant it set loading and prevented the saved rows from ever restoring.
      await hydrateFeedCache();
      if (cancelled) {
        return;
      }
      const current = feedCache.get(cacheKey);
      if (current.status === "idle" || current.stale) {
        void runFetch("replace", null);
      } else if (active && current.pages.length > 0) {
        startProbe(cacheKey);
      }
    })();
    return () => {
      cancelled = true;
      if (activeKeyRef.current === cacheKey) {
        activeKeyRef.current = null;
      }
      stopProbe();
    };
    // Runs on mount/tab-switch/enable; runFetch is stable per cacheKey.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- intentional mount-fill keyed by cacheKey via runFetch identity
  }, [active, cacheKey, enabled, runFetch, stopProbe, startProbe]);

  const fetchNext = useCallback(() => {
    const current = feedCache.get(cacheKey);
    if (
      !enabled ||
      (current.status !== "success" && current.status !== "error") ||
      !current.hasMore
    ) {
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
    stopProbe();
    setIncomingIds(new Set());
    setNewItems([]);
    feedCache.invalidate(cacheKey);
    void runFetch("replace", null, true);
  }, [cacheKey, enabled, runFetch, stopProbe]);

  const clearNewItems = useCallback(() => {
    setNewItems([]);
  }, []);

  const showNewPosts = clearNewItems;

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
    incomingIds,
    newItems,
    posts,
    refresh,
    showNewPosts,
    status,
    undoDismiss,
  };
}

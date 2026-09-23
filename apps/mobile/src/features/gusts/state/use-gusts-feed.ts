// The reel's data hook, ported from web's client-gusts useInfiniteQuery +
// useNewContentProbe. Pages come from /api/gusts (first page by deep link or
// head, later pages by cursor), flatten through mergeGustPages (dedupe,
// video-only, hidden ids out), and keep loading while a page yields no
// playable gust but more exist. Transient failures retry with backoff; a
// failed first load surfaces as an error state (web silently shows the empty
// panel). The probe checks the head every 45s, never on a deep link, and
// its finds are prepended when the pill is tapped.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { FeedApiError } from "@/features/feed/lib/feed-api";
import type { FeedPost, PostsPage } from "@/features/feed/lib/feed-types";
import { findUnseenItems } from "@/features/feed/lib/feed-types";
import { HttpError, withRetry } from "@/features/media-upload/lib/retry";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

import {
  fetchGustsPage,
  isPlayableGust,
  mergeGustPages,
} from "../lib/gusts-api";
import type { GustTab, GustsQuery } from "../lib/gusts-api";

const PROBE_INTERVAL_MS = 45_000;

type Status = "error" | "loading" | "ready";

async function loadPage(query: GustsQuery): Promise<PostsPage> {
  const apiBase = getApiBaseUrl();
  return await withRetry(
    async () => {
      const cookie = await authClient.getCookie();
      try {
        return await fetchGustsPage(query, { apiBase, cookie });
      } catch (error) {
        // Map the feed error onto HttpError so a 4xx is not retried.
        if (error instanceof FeedApiError) {
          throw new HttpError(error.message, error.status);
        }
        throw error;
      }
    },
    {
      attempts: 3,
      baseMs: 600,
      onRetry: (error, attempt, delayMs) =>
        logWarn("gusts.page_retry", {
          attempt,
          delayMs,
          status: error instanceof HttpError ? error.status : 0,
        }),
    }
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useGustsFeed(options: {
  // Held until the session resolves, so a signed-in viewer never pays for
  // a guest fetch that is thrown away a moment later.
  enabled: boolean;
  initialId: string | null;
  tab: GustTab;
  userId: string | null;
}) {
  const { enabled, initialId, tab, userId } = options;
  const personalized = tab === "personalized" && !initialId;
  const feedKey = `${tab}:${initialId ?? ""}:${userId ?? "guest"}`;
  const [pages, setPages] = useState<PostsPage[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [fetchingNext, setFetchingNext] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [newItems, setNewItems] = useState<FeedPost[]>([]);
  // The key a load was started for; late responses for an old key drop.
  const keyRef = useRef(feedKey);
  const fetchingRef = useRef(false);

  const nextCursor = pages.at(-1)?.nextCursor ?? null;
  const posts = useMemo(
    () => mergeGustPages(pages, hiddenIds),
    [hiddenIds, pages]
  );

  const loadFirst = useCallback(
    async (mode: "initial" | "refresh") => {
      const key = feedKey;
      const startedAt = Date.now();
      try {
        const page = await loadPage({ initialId, personalized });
        if (keyRef.current !== key) {
          return;
        }
        setPages([page]);
        setNewItems([]);
        setStatus("ready");
        logInfo(mode === "refresh" ? "gusts.refreshed" : "gusts.loaded", {
          count: page.posts.length,
          deepLink: Boolean(initialId),
          ms: Date.now() - startedAt,
          personalized,
        });
      } catch (error) {
        if (keyRef.current !== key) {
          return;
        }
        logWarn("gusts.load_failed", { mode, reason: reason(error) });
        if (mode === "initial") {
          setStatus("error");
        }
      }
    },
    [feedKey, initialId, personalized]
  );

  // A new tab, deep link or identity starts over from the first page.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    keyRef.current = feedKey;
    fetchingRef.current = false;
    // oxlint-disable-next-line react/set-state-in-effect -- a new feed key resets the reel before its first page loads
    setPages([]);
    // oxlint-disable-next-line react/set-state-in-effect -- same reset as above
    setStatus("loading");
    // oxlint-disable-next-line react/set-state-in-effect -- same reset as above
    setFetchingNext(false);
    void loadFirst("initial");
  }, [enabled, feedKey, loadFirst]);

  const fetchNext = useCallback(async () => {
    if (fetchingRef.current || !nextCursor) {
      return;
    }
    fetchingRef.current = true;
    setFetchingNext(true);
    const key = feedKey;
    // No finally: the React Compiler rejects try/finally, so the reset is
    // written out on both paths (same reason as update-gate.ts).
    try {
      const page = await loadPage({
        cursor: nextCursor,
        initialId,
        personalized,
      });
      if (keyRef.current === key) {
        setPages((current) => [...current, page]);
        fetchingRef.current = false;
        setFetchingNext(false);
      }
    } catch (error) {
      logWarn("gusts.page_failed", { reason: reason(error) });
      if (keyRef.current === key) {
        fetchingRef.current = false;
        setFetchingNext(false);
      }
    }
  }, [feedKey, initialId, nextCursor, personalized]);

  // Web keeps paging while the list is empty but more exist (a page of
  // only moderated or video-less posts).
  useEffect(() => {
    if (status === "ready" && posts.length === 0 && nextCursor) {
      // oxlint-disable-next-line react/set-state-in-effect -- auto-drain: an empty ready page with a cursor pages on, exactly like web
      void fetchNext();
    }
  }, [fetchNext, nextCursor, posts.length, status]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadFirst("refresh");
    setRefreshing(false);
  }, [loadFirst]);

  const retry = useCallback(() => {
    setStatus("loading");
    void loadFirst("initial");
  }, [loadFirst]);

  // New-gusts probe: head page every 45s, skipped on deep links.
  const knownIds = useMemo(
    () => new Set(posts.map((post) => post.id)),
    [posts]
  );
  const knownRef = useRef(knownIds);
  useEffect(() => {
    knownRef.current = knownIds;
  }, [knownIds]);
  useEffect(() => {
    if (initialId || status !== "ready") {
      return;
    }
    const key = feedKey;
    const probe = async () => {
      try {
        const head = await fetchGustsPage(
          { personalized },
          { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() }
        );
        if (keyRef.current !== key || knownRef.current.size === 0) {
          return;
        }
        const fresh = findUnseenItems(
          head.posts.filter(isPlayableGust),
          knownRef.current
        );
        setNewItems(fresh);
      } catch (error) {
        logWarn("gusts.probe_failed", { reason: reason(error) });
      }
    };
    const timer = setInterval(() => {
      void probe();
    }, PROBE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [feedKey, initialId, personalized, status]);

  const showNewItems = useCallback(() => {
    if (newItems.length === 0) {
      return;
    }
    logInfo("gusts.new_shown", { count: newItems.length });
    setPages((current) => [{ nextCursor: null, posts: newItems }, ...current]);
    setNewItems([]);
  }, [newItems]);

  const hide = useCallback((postId: string) => {
    setHiddenIds((current) => new Set([...current, postId]));
  }, []);

  const unhide = useCallback((postId: string) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      next.delete(postId);
      return next;
    });
  }, []);

  return {
    fetchNext,
    fetchingNext,
    hasNextPage: nextCursor !== null,
    hide,
    newItems,
    posts,
    refresh,
    refreshing,
    retry,
    showNewItems,
    status,
    unhide,
  };
}

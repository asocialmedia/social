import {
  networkPostAllowed,
  networkPostRecommended,
} from "@asm/protocols/discovery";
// The reel's data hook, ported from web's client-gusts useInfiniteQuery +
// useNewContentProbe. Pages come from /api/gusts (first page by deep link or
// head, later pages by cursor), flatten through mergeGustPages (dedupe,
// video-only, hidden ids out), and keep loading while a page yields no
// playable gust but more exist. Transient failures retry with backoff; a
// failed first load surfaces as an error state (web silently shows the empty
// panel). The probe checks the Following head every 45s (web probes no
// other tab, and never a deep link), and its finds are prepended when the
// pill is tapped.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { readExternal } from "@/features/feed/lib/external-interactions";
import { externalPostView } from "@/features/feed/lib/external-post-view";
import { FeedApiError } from "@/features/feed/lib/feed-api";
import type { FeedPost, PostsPage } from "@/features/feed/lib/feed-types";
import { findUnseenItems } from "@/features/feed/lib/feed-types";
import {
  useExternalExclusions,
  useFeedSourceStore,
} from "@/features/feed/state/feed-source-store";
import { useBlueskyFeed } from "@/features/feed/state/use-bluesky-feed";
import { HttpError, withRetry } from "@/features/media-upload/lib/retry";
import type { NetworkRequestContext } from "@/features/network/lib/network-query";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";
import { logInfo, logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { createExpoPoller } from "@/lib/network/expo-poller";

import { gustPagingState } from "../lib/gust-sources";
import type { GustRetrySource } from "../lib/gust-sources";
import {
  fetchGustsPage,
  gustFeedSource,
  isPlayableGust,
  mergeGustPages,
} from "../lib/gusts-api";
import type { GustTab, GustsQuery } from "../lib/gusts-api";

const PROBE_INTERVAL_MS = 45_000;

type Status = "error" | "loading" | "ready";

async function loadPage(
  query: GustsQuery,
  network: NetworkRequestContext
): Promise<PostsPage> {
  const apiBase = getApiBaseUrl();
  return await withRetry(
    async () => {
      const cookie = await authClient.getCookie();
      try {
        return await fetchGustsPage(query, { apiBase, cookie, network });
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

function useAsmGustsFeed(options: {
  // Held until the session resolves, so a signed-in viewer never pays for
  // a guest fetch that is thrown away a moment later.
  enabled: boolean;
  initialId: string | null;
  tab: GustTab;
  userId: string | null;
}) {
  const { enabled, initialId, tab, userId } = options;
  const network = useNetworkSettings();
  const personalized = tab === "personalized" && !initialId;
  const following = tab === "following" && !initialId;
  const feedKey = `${tab}:${initialId ?? ""}:${userId ?? "guest"}:${network.scope}:${network.locale}`;
  const [pages, setPages] = useState<PostsPage[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [fetchingNext, setFetchingNext] = useState(false);
  // A later page failed after its retries. Web's isFetchNextPageError: the
  // reel stops auto-paging this source until the reader retries it.
  const [pageError, setPageError] = useState(false);
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
        const page = await loadPage(
          { following, initialId, personalized },
          network.request
        );
        if (keyRef.current !== key) {
          return;
        }
        setPages([page]);
        setNewItems([]);
        setPageError(false);
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
    [feedKey, following, initialId, personalized, network.request]
  );

  // A new tab, deep link or identity starts over from the first page.
  useEffect(() => {
    keyRef.current = feedKey;
    if (!enabled || !network.ready) {
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
    // oxlint-disable-next-line react/set-state-in-effect -- same reset as above
    setPageError(false);
    void loadFirst("initial");
    setHiddenIds(new Set());
    return () => {
      keyRef.current = "";
    };
  }, [enabled, feedKey, loadFirst, network.ready]);

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
      const page = await loadPage(
        {
          cursor: nextCursor,
          following,
          initialId,
          personalized,
        },
        network.request
      );
      if (keyRef.current === key) {
        setPages((current) => [...current, page]);
        setPageError(false);
        fetchingRef.current = false;
        setFetchingNext(false);
      }
    } catch (error) {
      logWarn("gusts.page_failed", { reason: reason(error) });
      if (keyRef.current === key) {
        setPageError(true);
        fetchingRef.current = false;
        setFetchingNext(false);
      }
    }
  }, [
    feedKey,
    following,
    initialId,
    nextCursor,
    personalized,
    network.request,
  ]);

  // Web keeps paging while the list is empty but more exist (a page of
  // only moderated or video-less posts).
  useEffect(() => {
    if (status === "ready" && posts.length === 0 && nextCursor && !pageError) {
      // oxlint-disable-next-line react/set-state-in-effect -- auto-drain: an empty ready page with a cursor pages on, exactly like web
      void fetchNext();
    }
  }, [fetchNext, nextCursor, pageError, posts.length, status]);

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
    // Web probes the head only on Following: For you and Latest are ranked
    // or rolling, so a "new" head there is noise and costs a request a turn.
    if (!enabled || !following || status !== "ready") {
      return;
    }
    const key = feedKey;
    const probe = async () => {
      try {
        const head = await fetchGustsPage(
          { following, personalized },
          {
            apiBase: getApiBaseUrl(),
            cookie: await authClient.getCookie(),
            network: network.request,
          }
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
    const poller = createExpoPoller({
      intervalMs: PROBE_INTERVAL_MS,
      onPoll: probe,
    });
    poller.start();
    return () => poller.stop();
  }, [feedKey, following, personalized, status, enabled, network.request]);

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
    pageError,
    posts,
    refresh,
    refreshing,
    retry,
    showNewItems,
    status,
    unhide,
  };
}

export function useGustsFeed(options: {
  enabled: boolean;
  initialId: string | null;
  tab: GustTab;
  userId: string | null;
}) {
  const network = useNetworkSettings();
  const selectedSource = useFeedSourceStore((state) => state.source);
  const source = gustFeedSource(selectedSource, options.initialId);
  const exclusions = useExternalExclusions(network.viewer);
  const externalId = options.initialId?.startsWith("at://")
    ? options.initialId
    : null;
  const asm = useAsmGustsFeed({
    ...options,
    enabled: options.enabled && !externalId && source !== "bluesky",
    initialId: externalId ? null : options.initialId,
  });
  const remote = useBlueskyFeed(
    options.tab === "personalized" ? "personalized" : "latest",
    options.enabled && !options.initialId && source !== "asm",
    options.userId ?? undefined,
    options.tab === "following",
    { content: "video" }
  );
  const detail = useProtocolResource(
    `gust-detail:${network.viewer}:${externalId}`,
    (signal) => readExternal(externalId ?? "", undefined, signal),
    Boolean(externalId && options.enabled)
  );
  const key = `${network.viewer}:${network.scope}:${network.locale}:${options.tab}:${options.initialId}:${source}`;
  const [order, setOrder] = useState<{ key: string; ids: string[] }>({
    ids: [],
    key: "",
  });
  let candidates = [
    ...(source === "bluesky" ? [] : asm.posts),
    ...(source === "asm" ? [] : remote.posts.map(externalPostView)),
  ];
  if (externalId) {
    candidates = detail.data?.post ? [externalPostView(detail.data.post)] : [];
  }
  const eligible = candidates
    .filter(
      (post) =>
        network.ready &&
        (!post.external ||
          (!exclusions.has(`post:${post.id}`) &&
            !exclusions.has(`author:${post.external.author.id}`))) &&
        (options.initialId || options.tab === "following"
          ? networkPostAllowed(
              post,
              network.settings.preferences,
              network.settings.topicScope
            )
          : networkPostRecommended(
              post,
              network.settings.preferences,
              network.settings.topicScope
            ))
    )
    .map((post) => ({ ...post, isGust: true }));
  const ids = eligible.map((post) => post.id).join("\n");
  const [orderVersion, setOrderVersion] = useState("");
  const orderKey = `${key}:${ids}`;
  if (orderVersion !== orderKey) {
    setOrderVersion(orderKey);
    const existing = order.key === key ? order.ids : [];
    const seen = new Set(existing);
    setOrder({
      ids: [
        ...existing,
        ...ids.split("\n").filter((id) => id && !seen.has(id)),
      ],
      key,
    });
  }
  const byId = new Map(eligible.map((post) => [post.id, post]));
  const orderedIds =
    order.key === key
      ? [
          ...order.ids,
          ...eligible
            .filter((post) => !order.ids.includes(post.id))
            .map((post) => post.id),
        ]
      : eligible.map((post) => post.id);
  const posts = orderedIds.flatMap((id) => {
    const post = byId.get(id);
    return post && post.attachments?.some((media) => media.type === "VIDEO")
      ? [post]
      : [];
  });
  const bothFailed =
    (source === "bluesky" || asm.status === "error") &&
    (source === "asm" || remote.status === "error");
  let status: Status = "loading";
  if (externalId) {
    if (detail.data) {
      status = "ready";
    } else if (detail.error) {
      status = "error";
    }
  } else if (
    posts.length ||
    ((source === "bluesky" || asm.status !== "loading") &&
      (source === "asm" || remote.status !== "loading"))
  ) {
    status = "ready";
  }
  if (
    (!network.ready && network.error) ||
    (!externalId && !posts.length && bothFailed)
  ) {
    status = "error";
  }
  // Web's retrySources: each source's failure and retry stand alone, so a
  // Bluesky outage leaves ASM gusts playing and vice versa. A failed later
  // page retries its own cursor; a failed first load starts that source over.
  const asmEnabled = !externalId && source !== "bluesky";
  const remoteEnabled = !options.initialId && source !== "asm";
  const remotePageError = remote.status === "error" && remote.pages.length > 0;
  const sources: GustRetrySource[] = [
    {
      enabled: asmEnabled,
      handleRetry: () => {
        if (asm.pageError) {
          void asm.fetchNext();
        } else {
          asm.retry();
        }
      },
      hasError: asm.status === "error" || asm.pageError,
      hasNextPage: asm.hasNextPage,
      isFetching: asm.status === "loading" || asm.fetchingNext,
      isFetchingNextPage: asm.fetchingNext,
      label: "ASM",
      pageError: asm.pageError,
    },
    {
      enabled: remoteEnabled,
      handleRetry: () => {
        void remote.retry();
      },
      hasError: remote.status === "error",
      hasNextPage: remote.hasMore,
      isFetching: remote.status === "loading" || remote.loadingMore,
      isFetchingNextPage: remote.loadingMore,
      label: "Bluesky",
      pageError: remotePageError,
    },
  ];
  const paging = gustPagingState(sources);
  return {
    ...asm,
    canFetchNextPage: !externalId && paging.canFetchNextPage,
    error:
      (network.ready ? null : network.error) ?? detail.error ?? remote.error,
    // Auto-paging skips a source whose last page failed (web's fetchNextPage
    // guard), so a dead source is not hammered while its peer pages on.
    fetchNext: async () => {
      if (externalId) {
        return;
      }
      await Promise.all([
        asmEnabled && !asm.pageError ? asm.fetchNext() : undefined,
        remoteEnabled && !remotePageError ? remote.fetchNext() : undefined,
      ]);
    },
    fetchingNext: asm.fetchingNext || remote.loadingMore,
    hasNextPage:
      !externalId &&
      ((source !== "bluesky" && asm.hasNextPage) ||
        (source !== "asm" && remote.hasMore)),
    // Web surfaces new gusts only on Following: its own clips pass the
    // Following filter, Bluesky heads pass the recommendation filter.
    newItems:
      options.tab === "following" && !options.initialId
        ? [
            ...(source === "bluesky" ? [] : asm.newItems).filter((post) =>
              networkPostAllowed(
                post,
                network.settings.preferences,
                network.settings.topicScope
              )
            ),
            ...(source === "asm"
              ? []
              : remote.newItems
                  .map(externalPostView)
                  .filter((post) =>
                    networkPostRecommended(
                      post,
                      network.settings.preferences,
                      network.settings.topicScope
                    )
                  )),
          ]
        : [],
    pageError: !externalId && paging.pageError,
    posts,
    refresh: async () => {
      if (!network.ready) {
        await network.refetch();
        return;
      }
      setOrder({ ids: [], key });
      if (externalId) {
        await detail.refetch();
        return;
      }
      await Promise.all([
        source === "bluesky" ? undefined : asm.refresh(),
        source === "asm" ? undefined : remote.refresh(),
      ]);
    },
    retry: () => {
      if (!network.ready) {
        void network.refetch();
        return;
      }
      if (externalId) {
        void detail.refetch();
      } else {
        if (source !== "bluesky") {
          asm.retry();
        }
        if (source !== "asm") {
          void remote.refresh();
        }
      }
    },
    showNewItems: () => {
      asm.showNewItems();
      remote.acceptNew();
      setOrder({ ids: [], key });
    },
    sources: externalId ? [] : sources,
    status,
  };
}

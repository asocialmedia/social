// Both sources of web's HashtagFeed: asocialmedia posts and Bluesky posts for
// one tag, each paged by its own cursor, gated by the feed source store and
// the Network settings, and filtered the way web's FeedView filters them.
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalNetworkPostAllowed,
  filterExternalRecommendations,
  networkPostAllowed,
} from "@asm/protocols/discovery";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSessionContext } from "@/features/auth/state/session";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import {
  useExternalExclusions,
  useFeedSourceStore,
} from "@/features/feed/state/feed-source-store";
import { networkRequest } from "@/features/network/lib/network-api";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";

import {
  appendUnique,
  blueskyHashtagPath,
  hashtagFeedView,
  hashtagPostsPath,
  hashtagTimelineRows,
  parseBlueskyHashtagPage,
  parseHashtagPage,
} from "../lib/hashtag-api";
import type { HashtagPage } from "../lib/hashtag-api";

interface PagedState<Item> {
  cursor: string | null;
  error: boolean;
  failedNext: boolean;
  fetching: boolean;
  items: Item[];
  loaded: boolean;
}

function initialState<Item>(): PagedState<Item> {
  return {
    cursor: null,
    error: false,
    failedNext: false,
    fetching: false,
    items: [],
    loaded: false,
  };
}

// One cursor-paged source. `scope` names what the pages belong to (tag,
// viewer, Network scope); a new scope starts over, like a new react-query key
// on web. A disabled source keeps what it loaded so switching the feed source
// back does not refetch.
function usePagedSource<Item extends { id: string }>(
  scope: string,
  enabled: boolean,
  read: (
    cursor: string | null,
    signal: AbortSignal
  ) => Promise<HashtagPage<Item>>
) {
  const [state, setState] = useState<PagedState<Item>>(initialState);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const loadedScope = useRef<string | null>(null);

  const load = useCallback(
    (cursor: string | null, replace: boolean) => {
      if (controller.current) {
        return;
      }
      const current = new AbortController();
      const requestGeneration = generation.current;
      controller.current = current;
      setState((previous) =>
        replace
          ? { ...initialState<Item>(), fetching: true }
          : { ...previous, error: false, failedNext: false, fetching: true }
      );
      void (async () => {
        let page: HashtagPage<Item> | null = null;
        try {
          page = await read(cursor, current.signal);
        } catch {
          // The failure is recorded below; the cause is not shown to readers.
        }
        if (controller.current === current) {
          controller.current = null;
        }
        if (generation.current !== requestGeneration) {
          return;
        }
        if (!page) {
          setState((previous) => ({
            ...previous,
            error: true,
            failedNext: !replace,
            fetching: false,
          }));
          return;
        }
        const loaded = page;
        loadedScope.current = scope;
        setState((previous) => ({
          cursor: loaded.cursor,
          error: false,
          failedNext: false,
          fetching: false,
          items: appendUnique(replace ? [] : previous.items, loaded.items),
          loaded: true,
        }));
      })();
    },
    [read, scope]
  );

  useEffect(() => {
    if (!enabled || loadedScope.current === scope) {
      return;
    }
    load(null, true);
    return () => {
      // A disabled or rescoped source drops its in-flight read; the counter
      // keeps a late answer from landing in the next scope's state.
      generation.current += 1;
      controller.current?.abort();
      controller.current = null;
      setState((previous) =>
        previous.fetching ? { ...previous, fetching: false } : previous
      );
    };
  }, [enabled, load, scope]);

  const fetchNext = useCallback(() => {
    if (
      enabled &&
      state.loaded &&
      state.cursor &&
      !state.error &&
      !controller.current
    ) {
      load(state.cursor, false);
    }
  }, [enabled, load, state.cursor, state.error, state.loaded]);

  const retry = useCallback(() => {
    if (!enabled || !state.error) {
      return;
    }
    if (state.failedNext && state.cursor) {
      load(state.cursor, false);
    } else {
      load(null, true);
    }
  }, [enabled, load, state.cursor, state.error, state.failedNext]);

  return {
    error: state.error,
    fetchNext,
    fetching: state.fetching,
    hasMore: state.loaded && state.cursor !== null,
    items: state.items,
    // Pending until the first page lands, including while the Network
    // settings are still loading, matching a disabled react-query query.
    pending: !state.loaded && !state.error,
    retry,
  };
}

function readNativePage(tag: string) {
  return async (cursor: string | null, signal: AbortSignal) =>
    parseHashtagPage(
      await networkRequest(hashtagPostsPath(tag, cursor), { signal })
    );
}

function readBlueskyPage(tag: string) {
  return async (cursor: string | null, signal: AbortSignal) =>
    parseBlueskyHashtagPage(
      await networkRequest(blueskyHashtagPath(tag, cursor), { signal })
    );
}

export function useHashtagFeed(tag: string) {
  const { user } = useSessionContext();
  const viewer = user?.id ?? "guest";
  const network = useNetworkSettings();
  const source = useFeedSourceStore((state) => state.source);
  const showNative = source !== "bluesky";
  const showRemote = source !== "asm";
  const excluded = useExternalExclusions(viewer);
  const scope = `${tag}:${viewer}:${network.scope}`;

  const readNative = useMemo(() => readNativePage(tag), [tag]);
  const readRemote = useMemo(() => readBlueskyPage(tag), [tag]);
  const native = usePagedSource<FeedPost>(
    scope,
    network.ready && showNative,
    readNative
  );
  const remote = usePagedSource<ExternalPost>(
    scope,
    network.ready && showRemote,
    readRemote
  );

  const { preferences, topicScope } = network.settings;
  const posts = useMemo(
    () =>
      showNative && network.ready
        ? native.items.filter((post) =>
            networkPostAllowed(post, preferences, topicScope)
          )
        : [],
    [native.items, network.ready, preferences, showNative, topicScope]
  );
  const external = useMemo(
    () =>
      filterExternalRecommendations(
        showRemote && network.ready
          ? remote.items.filter((post) =>
              externalNetworkPostAllowed(post, preferences, topicScope)
            )
          : [],
        excluded
      ),
    [excluded, network.ready, preferences, remote.items, showRemote, topicScope]
  );
  const rows = useMemo(
    () => hashtagTimelineRows(posts, external, source),
    [external, posts, source]
  );

  const pending =
    (showNative && native.pending) || (showRemote && remote.pending);
  const fetching =
    (showNative && native.fetching) || (showRemote && remote.fetching);
  const hasMore =
    (showNative && native.hasMore) || (showRemote && remote.hasMore);
  const failed = (showNative && native.error) || (showRemote && remote.error);
  const hasContent = rows.length > 0;

  const nativeFetchNext = native.fetchNext;
  const remoteFetchNext = remote.fetchNext;
  const nativeRetry = native.retry;
  const remoteRetry = remote.retry;
  const loadMore = useCallback(() => {
    if (showNative) {
      nativeFetchNext();
    }
    if (showRemote) {
      remoteFetchNext();
    }
  }, [nativeFetchNext, remoteFetchNext, showNative, showRemote]);
  const retry = useCallback(() => {
    if (showNative) {
      nativeRetry();
    }
    if (showRemote) {
      remoteRetry();
    }
  }, [nativeRetry, remoteRetry, showNative, showRemote]);

  return {
    failed,
    fetching,
    hasContent,
    hasMore,
    loadMore,
    network,
    retry,
    rows,
    scope,
    source,
    view: hashtagFeedView({
      failed,
      hasContent,
      hasMore,
      networkError: Boolean(network.error),
      networkReady: network.ready,
      pending,
    }),
    viewerId: user?.id,
  };
}

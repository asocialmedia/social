// Cross-conversation message search for the conversation list.
//
// Ported from apps/web/src/lib/messages/use-global-message-search.ts. The
// server returns ciphertext hits under a signed session token; each hit is
// decrypted here through the shared decryptor with the identity's key source,
// so nothing new is sent in plaintext beyond the query web already sends.

import { normalizeMessageSearchQuery } from "@asm/messages/normalization";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { searchGlobalMessages } from "@/features/messages/lib/client";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import {
  buildGlobalSearchResult,
  GLOBAL_SEARCH_DEBOUNCE_MS,
  GlobalSearchRequestError,
  isHitExpired,
  mergeGlobalSearchHits,
  nextHitExpiry,
} from "@/features/messages/lib/global-message-search";
import type {
  GlobalMessageSearchFilter,
  GlobalMessageSearchHit,
  GlobalMessageSearchResult,
} from "@/features/messages/lib/global-message-search";
import { getApiBaseUrl } from "@/lib/network/api-env";

import { useMessagesIdentity } from "./message-identity";
import { unreadMessageStore } from "./unread-message-store";
import { useMessagesForeground } from "./use-messages-foreground";

const AUTOMATIC_REFRESH_MS = 15_000;
const EMPTY_HITS: GlobalMessageSearchHit[] = [];

interface SearchState {
  coverageComplete: boolean;
  coveragePaused: boolean;
  error: string | null;
  hasMore: boolean;
  hits: GlobalMessageSearchHit[];
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  retryAt: number;
  searchKey: string | null;
  sessionToken: string | null;
}

const EMPTY_STATE: SearchState = {
  coverageComplete: true,
  coveragePaused: false,
  error: null,
  hasMore: false,
  hits: EMPTY_HITS,
  loading: false,
  loadingMore: false,
  nextCursor: null,
  retryAt: 0,
  searchKey: null,
  sessionToken: null,
};

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function useGlobalMessageSearch(input: {
  conversationType: GlobalMessageSearchFilter;
  query: string;
}) {
  const { getBaseKeys, identity, status, userId } = useMessagesIdentity();
  const foreground = useMessagesForeground();
  const [state, setState] = useState<SearchState>(EMPTY_STATE);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const lastAutomaticRefresh = useRef(0);
  const debouncedQuery = useDebouncedValue(
    input.query,
    GLOBAL_SEARCH_DEBOUNCE_MS
  );
  const normalized = normalizeMessageSearchQuery(debouncedQuery);
  const queryText = normalized.tokens.join(" ");
  const scope =
    userId && identity ? `${userId}\u0000${identity.publicKey}` : null;
  const searchKey = JSON.stringify([scope, input.conversationType, queryText]);
  const queryReady =
    input.query === debouncedQuery &&
    normalized.valid &&
    scope !== null &&
    status === "ready";
  const currentSearch = state.searchKey === searchKey;

  const requestPage = useCallback(
    async (page: {
      append: boolean;
      cursor: string | null;
      requestGeneration: number;
      sessionToken: string | null;
      signal: AbortSignal;
    }) => {
      try {
        const result = await searchGlobalMessages(
          {
            conversationType: input.conversationType,
            cursor: page.cursor,
            query: queryText,
            sessionToken: page.sessionToken,
          },
          { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() },
          page.signal
        );
        if (generation.current !== page.requestGeneration) {
          return;
        }
        // A cached preview can predate the authoritative search revision.
        for (const hit of result.hits) {
          messageDecryptor.invalidate(hit.id);
        }
        setState((current) => ({
          coverageComplete: result.coverageComplete,
          coveragePaused: result.coveragePaused,
          error: null,
          hasMore: result.hasMore,
          hits: mergeGlobalSearchHits(current.hits, result.hits, page.append),
          loading: false,
          loadingMore: false,
          nextCursor: result.nextCursor,
          retryAt: 0,
          searchKey,
          sessionToken: result.sessionToken,
        }));
      } catch (error) {
        if (
          page.signal.aborted ||
          generation.current !== page.requestGeneration
        ) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Message search is temporarily unavailable. Try again.";
        const retryAt =
          error instanceof GlobalSearchRequestError ? error.retryAt : 0;
        setState((current) =>
          current.searchKey === searchKey
            ? {
                ...current,
                error: message,
                hasMore:
                  error instanceof GlobalSearchRequestError &&
                  error.restartRequired
                    ? false
                    : current.hasMore,
                loading: false,
                loadingMore: false,
                retryAt,
              }
            : {
                ...EMPTY_STATE,
                coverageComplete: false,
                error: message,
                retryAt,
                searchKey,
              }
        );
      }
    },
    [input.conversationType, queryText, searchKey]
  );

  const startFresh = useCallback(() => {
    active.current?.abort();
    generation.current += 1;
    const controller = new AbortController();
    active.current = controller;
    setState({
      ...EMPTY_STATE,
      coverageComplete: false,
      loading: true,
      searchKey,
    });
    void requestPage({
      append: false,
      cursor: null,
      requestGeneration: generation.current,
      sessionToken: null,
      signal: controller.signal,
    });
  }, [requestPage, searchKey]);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    generation.current += 1;
    if (!queryReady) {
      return;
    }
    const requestGeneration = generation.current;
    const controller = new AbortController();
    active.current = controller;
    void requestPage({
      append: false,
      cursor: null,
      requestGeneration,
      sessionToken: null,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [queryReady, requestPage]);

  useEffect(
    () => () => {
      active.current?.abort();
      generation.current += 1;
    },
    []
  );

  const loadMore = useCallback(() => {
    if (
      state.loading ||
      state.loadingMore ||
      !state.hasMore ||
      !state.nextCursor ||
      !state.sessionToken ||
      state.retryAt > Date.now() ||
      !queryReady ||
      !currentSearch
    ) {
      return;
    }
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((current) => ({ ...current, error: null, loadingMore: true }));
    void requestPage({
      append: true,
      cursor: state.nextCursor,
      requestGeneration: generation.current,
      sessionToken: state.sessionToken,
      signal: controller.signal,
    });
  }, [currentSearch, queryReady, requestPage, state]);

  const retry = useCallback(() => {
    if (!queryReady || state.retryAt > Date.now()) {
      return;
    }
    startFresh();
  }, [queryReady, startFresh, state.retryAt]);

  // A message landing anywhere may change what matches; refresh at most every
  // 15 seconds while the results are on screen, like web's change broadcast.
  useEffect(() => {
    if (!queryReady || !foreground) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = unreadMessageStore.subscribeActivity(() => {
      if (timer !== null) {
        return;
      }
      timer = setTimeout(
        () => {
          timer = null;
          lastAutomaticRefresh.current = Date.now();
          startFresh();
        },
        Math.max(
          250,
          AUTOMATIC_REFRESH_MS - (Date.now() - lastAutomaticRefresh.current)
        )
      );
    });
    return () => {
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [foreground, queryReady, startFresh]);

  // Expiring (incognito-adjacent / disappearing) hits drop out on time.
  const nextExpiry = useMemo(
    () => nextHitExpiry(state.hits, now),
    [now, state.hits]
  );
  useEffect(() => {
    if (nextExpiry === null) {
      return;
    }
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, nextExpiry - Date.now() + 1)
    );
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  useEffect(() => {
    for (const hit of state.hits) {
      if (isHitExpired(hit, now)) {
        messageDecryptor.invalidate(hit.id);
      }
    }
  }, [now, state.hits]);

  const hits = useMemo(
    () =>
      (queryReady && currentSearch ? state.hits : EMPTY_HITS).filter(
        (hit) => !isHitExpired(hit, now)
      ),
    [currentSearch, now, queryReady, state.hits]
  );

  const decryptVersion = useSyncExternalStore(
    messageDecryptor.subscribe,
    messageDecryptor.getVersion,
    messageDecryptor.getVersion
  );

  useEffect(() => {
    // Reading the decrypt version re-runs this sweep whenever the decryptor
    // settles a batch, so hits that failed or arrived late get requested again.
    if (
      decryptVersion < 0 ||
      !foreground ||
      status !== "ready" ||
      hits.length === 0
    ) {
      return;
    }
    const items = hits.flatMap((hit) =>
      messageDecryptor.get(hit.id) === undefined
        ? [
            {
              conversationId: hit.conversationId,
              message: {
                ciphertext: hit.ciphertext,
                id: hit.id,
                iv: hit.iv,
                ratchetIndex: hit.ratchetIndex,
                senderId: hit.senderId,
              },
            },
          ]
        : []
    );
    if (items.length > 0) {
      messageDecryptor.requestUrgent(items, { getBaseKeys });
    }
  }, [decryptVersion, foreground, getBaseKeys, hits, status]);

  const results = useMemo<GlobalMessageSearchResult[]>(() => {
    if (decryptVersion < 0) {
      return [];
    }
    return hits.map((hit) =>
      buildGlobalSearchResult(hit, messageDecryptor.get(hit.id), queryText)
    );
  }, [decryptVersion, hits, queryText]);

  const settling = input.query !== debouncedQuery;
  return {
    coverageComplete: currentSearch ? state.coverageComplete : false,
    coveragePaused: currentSearch && state.coveragePaused,
    error: currentSearch ? state.error : null,
    hasMore: currentSearch && state.hasMore,
    loadMore,
    loading: settling || (queryReady && (!currentSearch || state.loading)),
    loadingMore: queryReady && currentSearch && state.loadingMore,
    messageQueryValid: normalizeMessageSearchQuery(input.query).valid,
    queryReady,
    results: queryReady && currentSearch ? results : [],
    retry,
    retryAt: currentSearch ? state.retryAt : 0,
  };
}

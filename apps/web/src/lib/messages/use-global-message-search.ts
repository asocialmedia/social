"use client";

import type { MessagePayload } from "@asm/messages/crypto";
import { normalizeMessageSearchQuery } from "@asm/messages/search";
import type { Dispatch, SetStateAction } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { importRatchetBaseKey } from "@/lib/messages/crypto";
import { messageDecryptor } from "@/lib/messages/decryptor";
import { createMessageChangeBroadcast } from "@/lib/messages/message-change-broadcast";
import {
  extractSearchableText,
  rankSearchResults,
} from "@/lib/messages/message-search";
import type { RankedSearchResult } from "@/lib/messages/message-search";
import {
  fetchMessageSearchJson,
  MessageSearchRequestError,
} from "@/lib/messages/search-request";
import { useRootKeyStore } from "@/lib/messages/use-decryption";

const SEARCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 20;
const MAX_RETAINED_HITS = 60;
const EMPTY_HITS: GlobalMessageSearchHit[] = [];

export type GlobalMessageSearchFilter = "ALL" | "DEN" | "DM";

export interface GlobalMessageSearchHit {
  ciphertext: string;
  conversationAvatarMediaId: string | null;
  conversationId: string;
  conversationName: string | null;
  conversationType: "DEN" | "DM";
  createdAt: string;
  expiresAt: string | null;
  id: string;
  iv: string;
  keyEpoch: number;
  peerAvatarUrl: string | null;
  peerName: string | null;
  peerUsername: string | null;
  ratchetIndex: number;
  revision: number;
  rootKeyCiphertext: string | null;
  rootKeyIv: string | null;
  rootKeyWrapperPublicKey: string | null;
  senderId: string;
  senderName: string;
  senderUsername: string;
}

export interface GlobalMessageSearchResult {
  hit: GlobalMessageSearchHit;
  preview: RankedSearchResult | null;
  previewFailed: boolean;
}

interface GlobalSearchPageResponse {
  coverageComplete: boolean;
  coveragePaused: boolean;
  hasMore: boolean;
  hits: GlobalMessageSearchHit[];
  nextCursor: string | null;
  sessionToken: string;
}

interface GlobalSearchState {
  coverageComplete: boolean;
  coveragePaused: boolean;
  error: string | null;
  hits: GlobalMessageSearchHit[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  retryAt: number;
  searchKey: string | null;
  sessionToken: string | null;
}

const EMPTY_STATE: GlobalSearchState = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseHit(value: unknown): GlobalMessageSearchHit | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.ciphertext !== "string" ||
    typeof value.conversationId !== "string" ||
    (value.conversationType !== "DEN" && value.conversationType !== "DM") ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.id !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.keyEpoch !== "number" ||
    !Number.isSafeInteger(value.keyEpoch) ||
    typeof value.ratchetIndex !== "number" ||
    !Number.isSafeInteger(value.ratchetIndex) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.senderId !== "string" ||
    typeof value.senderName !== "string" ||
    typeof value.senderUsername !== "string" ||
    !isNullableString(value.conversationAvatarMediaId) ||
    !isNullableString(value.conversationName) ||
    !isNullableString(value.expiresAt) ||
    !isNullableString(value.peerAvatarUrl) ||
    !isNullableString(value.peerName) ||
    !isNullableString(value.peerUsername) ||
    !isNullableString(value.rootKeyCiphertext) ||
    !isNullableString(value.rootKeyIv) ||
    !isNullableString(value.rootKeyWrapperPublicKey)
  ) {
    return null;
  }
  if (
    value.expiresAt !== null &&
    (typeof value.expiresAt !== "string" ||
      Number.isNaN(Date.parse(value.expiresAt)))
  ) {
    return null;
  }
  if (
    (value.rootKeyCiphertext === null) !== (value.rootKeyIv === null) ||
    (value.rootKeyCiphertext === null) !==
      (value.rootKeyWrapperPublicKey === null)
  ) {
    return null;
  }
  return {
    ciphertext: value.ciphertext,
    conversationAvatarMediaId: value.conversationAvatarMediaId,
    conversationId: value.conversationId,
    conversationName: value.conversationName,
    conversationType: value.conversationType,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    id: value.id,
    iv: value.iv,
    keyEpoch: value.keyEpoch,
    peerAvatarUrl: value.peerAvatarUrl,
    peerName: value.peerName,
    peerUsername: value.peerUsername,
    ratchetIndex: value.ratchetIndex,
    revision: value.revision,
    rootKeyCiphertext: value.rootKeyCiphertext,
    rootKeyIv: value.rootKeyIv,
    rootKeyWrapperPublicKey: value.rootKeyWrapperPublicKey,
    senderId: value.senderId,
    senderName: value.senderName,
    senderUsername: value.senderUsername,
  };
}

function parsePage(value: unknown): GlobalSearchPageResponse {
  if (
    !isRecord(value) ||
    typeof value.coverageComplete !== "boolean" ||
    typeof value.coveragePaused !== "boolean" ||
    typeof value.hasMore !== "boolean" ||
    !Array.isArray(value.hits) ||
    value.hits.length > PAGE_SIZE ||
    !value.hits.every((hit) => parseHit(hit) !== null) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string") ||
    typeof value.sessionToken !== "string"
  ) {
    throw new Error("Search results could not be loaded");
  }
  return {
    coverageComplete: value.coverageComplete,
    coveragePaused: value.coveragePaused,
    hasMore: value.hasMore,
    hits: value.hits.flatMap((hit) => {
      const parsed = parseHit(hit);
      return parsed ? [parsed] : [];
    }),
    nextCursor: value.nextCursor,
    sessionToken: value.sessionToken,
  };
}

function searchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "";
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Connect to search messages across your history.";
  }
  return error instanceof Error
    ? error.message
    : "Message search is temporarily unavailable. Try again.";
}

export function useGlobalMessageSearch(input: {
  conversationType: GlobalMessageSearchFilter;
  enabled: boolean;
  query: string;
  visible: boolean;
}) {
  const { user } = useSession();
  const { recoveryGeneration } = useMessagesIdentity();
  const rootKeyStore = useRootKeyStore();
  const userId = user?.id ?? null;
  const identityScope = userId
    ? `${userId}\u0000${recoveryGeneration ?? "identity-pending"}`
    : "anonymous";
  const [state, setState] = useState<GlobalSearchState>(EMPTY_STATE);
  const [now, setNow] = useState(() => Date.now());
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const lastAutomaticRefreshAt = useRef(0);
  const debouncedQuery = useDebouncedValue(input.query, SEARCH_DEBOUNCE_MS);
  const normalized = normalizeMessageSearchQuery(debouncedQuery);
  const queryText = normalized.tokens.join(" ");
  const searchKey = JSON.stringify([
    identityScope,
    input.conversationType,
    queryText,
  ]);
  const searchRequest = useMemo(
    () => ({
      conversationType: input.conversationType,
      query: queryText,
      searchKey,
    }),
    [input.conversationType, queryText, searchKey]
  );
  const queryReady =
    input.enabled &&
    input.query === debouncedQuery &&
    normalized.valid &&
    userId !== null &&
    recoveryGeneration !== null;
  const currentSearch = state.searchKey === searchKey;

  useEffect(() => {
    messageDecryptor.configureScope(identityScope);
  }, [identityScope]);

  const nextExpirationAt = useMemo(() => {
    let earliest: number | null = null;
    for (const hit of state.hits) {
      if (!hit.expiresAt) {
        continue;
      }
      const expiresAt = Date.parse(hit.expiresAt);
      if (expiresAt <= now) {
        continue;
      }
      if (earliest === null || expiresAt < earliest) {
        earliest = expiresAt;
      }
    }
    return earliest;
  }, [now, state.hits]);

  useEffect(() => {
    if (nextExpirationAt === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, nextExpirationAt - Date.now() + 1)
    );
    return () => window.clearTimeout(timer);
  }, [nextExpirationAt]);

  useEffect(() => {
    for (const hit of state.hits) {
      if (hit.expiresAt && Date.parse(hit.expiresAt) <= now) {
        messageDecryptor.invalidate(hit.id);
      }
    }
  }, [now, state.hits]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestGeneration.current += 1;
    if (!queryReady) {
      return;
    }
    const generation = requestGeneration.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    void requestPage({
      conversationType: searchRequest.conversationType,
      cursor: null,
      generation,
      query: searchRequest.query,
      requestGeneration,
      searchKey: searchRequest.searchKey,
      sessionToken: null,
      setState,
      signal: controller.signal,
    });
    return () => {
      controller.abort();
    };
  }, [queryReady, searchRequest]);

  const loadMore = useCallback(async () => {
    if (
      state.loading ||
      state.loadingMore ||
      !state.hasMore ||
      !state.nextCursor ||
      !state.sessionToken ||
      state.retryAt > Date.now() ||
      !queryReady ||
      state.searchKey !== searchKey
    ) {
      return;
    }
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const generation = requestGeneration.current;
    setState((current) => ({ ...current, error: null, loadingMore: true }));
    await requestPage({
      append: true,
      conversationType: input.conversationType,
      cursor: state.nextCursor,
      generation,
      query: queryText,
      requestGeneration,
      searchKey,
      sessionToken: state.sessionToken,
      setState,
      signal: controller.signal,
    });
  }, [
    input.conversationType,
    queryText,
    queryReady,
    searchKey,
    state.hasMore,
    state.loading,
    state.loadingMore,
    state.nextCursor,
    state.retryAt,
    state.searchKey,
    state.sessionToken,
  ]);

  const retry = useCallback(() => {
    if (!queryReady || state.retryAt > Date.now()) {
      return;
    }
    activeRequest.current?.abort();
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({
      ...EMPTY_STATE,
      coverageComplete: false,
      loading: true,
      searchKey,
    });
    void requestPage({
      conversationType: input.conversationType,
      cursor: null,
      generation,
      query: queryText,
      requestGeneration,
      searchKey,
      sessionToken: null,
      setState,
      signal: controller.signal,
    });
  }, [input.conversationType, queryReady, queryText, searchKey, state.retryAt]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const broadcast = createMessageChangeBroadcast({
      onNotice(notice) {
        const invalidIds = new Set([
          ...notice.messageIds,
          ...notice.unavailableMessageIds,
        ]);
        for (const id of invalidIds) {
          messageDecryptor.invalidate(id);
        }
        setState((current) => ({
          ...current,
          hits: current.hits.filter(
            (hit) =>
              hit.conversationId !== notice.conversationId ||
              (!notice.resetRequired &&
                !notice.accessChanged &&
                !invalidIds.has(hit.id))
          ),
        }));
        if (queryReady && input.visible && refreshTimer === null) {
          refreshTimer = setTimeout(
            () => {
              refreshTimer = null;
              lastAutomaticRefreshAt.current = Date.now();
              retry();
            },
            Math.max(
              250,
              15_000 - (Date.now() - lastAutomaticRefreshAt.current)
            )
          );
        }
      },
      userId,
    });
    return () => {
      broadcast.close();
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
      }
    };
  }, [input.visible, queryReady, retry, userId]);

  useEffect(() => {
    if (!queryReady || !input.visible) {
      return;
    }
    const revalidate = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastAutomaticRefreshAt.current < 15_000
      ) {
        return;
      }
      lastAutomaticRefreshAt.current = Date.now();
      retry();
    };
    window.addEventListener("online", revalidate);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("online", revalidate);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [input.visible, queryReady, retry]);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      requestGeneration.current += 1;
    },
    []
  );

  const hits = useMemo(
    () =>
      (queryReady && currentSearch ? state.hits : EMPTY_HITS).filter(
        (hit) => !hit.expiresAt || Date.parse(hit.expiresAt) > now
      ),
    [currentSearch, now, queryReady, state.hits]
  );
  const decryptVersion = useSyncExternalStore(
    messageDecryptor.subscribe,
    messageDecryptor.getVersion,
    messageDecryptor.getVersion
  );
  const hitsByConversation = useMemo(() => {
    const byConversation = new Map<string, GlobalMessageSearchHit[]>();
    for (const hit of hits) {
      const rows = byConversation.get(hit.conversationId) ?? [];
      rows.push(hit);
      byConversation.set(hit.conversationId, rows);
    }
    return byConversation;
  }, [hits]);
  const getBaseKeys = useCallback(
    async (conversationId: string): Promise<CryptoKey[]> => {
      if (!rootKeyStore || !userId) {
        return [];
      }
      const rows = hitsByConversation.get(conversationId) ?? [];
      const wraps = new Map<
        number,
        {
          encryptedKey: { ciphertext: string; iv: string };
          version: number;
          wrapperPublicKeyBase64: string;
        }
      >();
      for (const hit of rows) {
        if (
          hit.rootKeyCiphertext &&
          hit.rootKeyIv &&
          hit.rootKeyWrapperPublicKey
        ) {
          wraps.set(hit.keyEpoch, {
            encryptedKey: {
              ciphertext: hit.rootKeyCiphertext,
              iv: hit.rootKeyIv,
            },
            version: hit.keyEpoch,
            wrapperPublicKeyBase64: hit.rootKeyWrapperPublicKey,
          });
        }
      }
      if (wraps.size === 0) {
        return [];
      }
      try {
        const roots = await rootKeyStore.getRootKeys(
          conversationId,
          [...wraps.values()],
          ""
        );
        return await Promise.all(roots.map(importRatchetBaseKey));
      } catch {
        return [];
      }
    },
    [hitsByConversation, rootKeyStore, userId]
  );

  useEffect(() => {
    if (decryptVersion !== messageDecryptor.getVersion()) {
      return;
    }
    if (!input.visible || !rootKeyStore || !userId || hits.length === 0) {
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
  }, [decryptVersion, getBaseKeys, hits, input.visible, rootKeyStore, userId]);

  const results = useMemo<GlobalMessageSearchResult[]>(() => {
    if (decryptVersion !== messageDecryptor.getVersion()) {
      return [];
    }
    return hits.map((hit) => {
      const entry = messageDecryptor.get(hit.id);
      if (!entry || entry === "pending" || entry === "error") {
        return {
          hit,
          preview: null,
          previewFailed: entry === "error",
        };
      }
      const searchable = extractSearchablePayload(entry);
      if (!searchable) {
        return { hit, preview: null, previewFailed: true };
      }
      const [preview] = rankSearchResults(
        [
          {
            createdAt: Date.parse(hit.createdAt),
            id: hit.id,
            text: searchable.text,
          },
        ],
        queryText
      );
      return {
        hit,
        preview: preview ?? null,
        previewFailed: preview === undefined,
      };
    });
  }, [decryptVersion, hits, queryText]);

  const settling = input.enabled && input.query !== debouncedQuery;
  return {
    coverageComplete: currentSearch ? state.coverageComplete : false,
    coveragePaused: currentSearch && state.coveragePaused,
    error: currentSearch ? state.error : null,
    hasMore: currentSearch && state.hasMore,
    loadMore,
    loading: settling || (queryReady && (!currentSearch || state.loading)),
    loadingMore: queryReady && currentSearch && state.loadingMore,
    queryReady,
    results: queryReady && currentSearch ? results : [],
    retry,
    retryAt: currentSearch ? state.retryAt : 0,
  };
}

function extractSearchablePayload(payload: MessagePayload) {
  if (
    payload.type !== "text" &&
    payload.type !== "media" &&
    payload.type !== "post"
  ) {
    return null;
  }
  return extractSearchableText(payload);
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

async function requestPage(input: {
  append?: boolean;
  conversationType: GlobalMessageSearchFilter;
  cursor: string | null;
  generation: number;
  query: string;
  requestGeneration: { current: number };
  searchKey: string;
  sessionToken: string | null;
  setState: Dispatch<SetStateAction<GlobalSearchState>>;
  signal: AbortSignal;
}) {
  try {
    const payload = await fetchMessageSearchJson(
      "/api/messages/search/global",
      {
        body: JSON.stringify({
          conversationType: input.conversationType,
          ...(input.cursor ? { cursor: input.cursor } : {}),
          query: input.query,
          ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: input.signal,
      }
    );
    const page = parsePage(payload);
    if (input.requestGeneration.current !== input.generation) {
      return;
    }
    // A cached thread preview can predate the authoritative search revision.
    for (const hit of page.hits) {
      messageDecryptor.invalidate(hit.id);
    }
    input.setState((current) => {
      const nextHits = input.append
        ? [...current.hits, ...page.hits].slice(-MAX_RETAINED_HITS)
        : page.hits;
      return {
        coverageComplete: page.coverageComplete,
        coveragePaused: page.coveragePaused,
        error: null,
        hasMore: page.hasMore,
        hits: nextHits,
        loading: false,
        loadingMore: false,
        nextCursor: page.nextCursor,
        retryAt: 0,
        searchKey: input.searchKey,
        sessionToken: page.sessionToken,
      };
    });
  } catch (error) {
    if (
      input.signal.aborted ||
      input.requestGeneration.current !== input.generation
    ) {
      return;
    }
    input.setState((current) => {
      const message = searchErrorMessage(error);
      const retryAt =
        error instanceof MessageSearchRequestError ? error.retryAt : 0;
      if (current.searchKey !== input.searchKey) {
        return {
          ...EMPTY_STATE,
          coverageComplete: false,
          error: message,
          retryAt,
          searchKey: input.searchKey,
        };
      }
      return {
        ...current,
        error: message,
        hasMore:
          error instanceof MessageSearchRequestError && error.restartRequired
            ? false
            : current.hasMore,
        loading: false,
        loadingMore: false,
        retryAt,
      };
    });
  }
}

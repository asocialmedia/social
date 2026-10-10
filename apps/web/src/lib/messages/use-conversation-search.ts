"use client";

import { normalizeMessageSearchQuery } from "@asm/messages/search";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { MessageData } from "@/lib/messages/types";

import { coverageRetryDelay } from "./coverage-retry-delay";
import { messageDecryptor } from "./decryptor";
import type { OfflineSearchCacheScope } from "./indexeddb-offline-search-cache";
import {
  buildRankedResults,
  extractSearchableText,
  scoreSearchCandidates,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
} from "./message-search";
import type { RankedSearchResult, SearchCandidate } from "./message-search";
import { rememberOfflineIndexedRevision } from "./offline-search-cache";
import {
  decodeOfflineSearchCursor,
  encodeOfflineSearchCursor,
  offlineSearchRecordToMessageData,
  shouldUseOfflineSearchForStatus,
} from "./offline-search-fallback";
import { offlineSearchWorkerClient } from "./offline-search-worker-client";
import type { OfflineSearchWorkerMessage } from "./offline-search-worker-core";
import { hydrateSearchHits } from "./search-hydration";
import type { SearchHydrationHit } from "./search-hydration";
import {
  MAX_RETAINED_SEARCH_PAGES,
  retainSearchResultPage,
  searchResultPage,
  searchResultPageRequest,
} from "./search-result-window";
import type { SearchResultWindow } from "./search-result-window";
import {
  isServerSearchScopeChanged,
  serverSearchHasMore,
  shouldRestartAfterServerSearchScopeChange,
  shouldPollServerSearchCoverage,
} from "./server-search-coverage";

export interface ConversationSearchInput {
  allMessages: MessageData[];
  conversationId: string;
  enabled: boolean;
  requestDecryptBatch: (messages: MessageData[]) => void;
  offlineSearchScope?: OfflineSearchCacheScope | null;
  offlineCacheRefreshToken?: number;
  serverSearchEnabled?: boolean;
  serverRefreshToken?: number;
  listPage?: number;
}

export interface ConversationSearch {
  debouncedQuery: string;
  listPageLoading: boolean;
  listPageError: string | null;
  listPageStale: boolean;
  matchIds: string[];
  query: string;
  results: RankedSearchResult[];
  setQuery: (query: string) => void;
  totalMatches: number;
  truncated: boolean;
  resultMessages: MessageData[];
  searching: boolean;
  searchError: string | null;
  offlineSearch: boolean;
  savedHistorySearch: boolean;
  totalMatchesExact: boolean;
  countState: "pending" | "exact" | "unavailable" | null;
  serverCoverageIncomplete: boolean;
  serverCoverageUnavailable: boolean;
  serverHasMore: boolean;
  pageHitIds: string[];
  windowStartPage: number;
  windowEndPage: number;
  canNextPage: boolean;
  canPreviousPage: boolean;
  retry: () => void;
}

const EMPTY_CORPUS: SearchCandidate[] = [];
// Shared empty result for a closed search, so the common case allocates nothing
// and the inline bar's `matchIds` identity stays stable while idle.
const EMPTY_MATCH_IDS: string[] = [];

interface ServerSearchPage {
  coverageComplete: boolean;
  coveragePaused: boolean;
  coverageSettled: boolean;
  countToken: string | null;
  hits: MessageData[];
  hitIds?: string[];
  offline: boolean;
  nextCursor: string | null;
  previousCursor: string | null;
  requestCursor: string | null;
  snapshotToken: string | null;
  totalMatches: number | null;
}

type ServerSearchSummary = Pick<
  ServerSearchPage,
  | "coverageComplete"
  | "coveragePaused"
  | "coverageSettled"
  | "countToken"
  | "offline"
  | "snapshotToken"
  | "totalMatches"
>;

interface ServerSearchPageState extends SearchResultWindow<ServerSearchPage> {
  key: string;
  summary: ServerSearchSummary | null;
  requestGeneration: number;
}

function searchPageSummary(page: ServerSearchPage): ServerSearchSummary {
  return {
    countToken: page.countToken,
    coverageComplete: page.coverageComplete,
    coveragePaused: page.coveragePaused,
    coverageSettled: page.coverageSettled,
    offline: page.offline,
    snapshotToken: page.snapshotToken,
    totalMatches: page.totalMatches,
  };
}

function isSearchApiHit(value: unknown): value is SearchHydrationHit {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.createdAt === "string" &&
    !Number.isNaN(new Date(row.createdAt).getTime()) &&
    typeof row.id === "string" &&
    typeof row.keyEpoch === "number" &&
    Number.isSafeInteger(row.keyEpoch) &&
    typeof row.ratchetIndex === "number" &&
    Number.isSafeInteger(row.ratchetIndex) &&
    typeof row.revision === "number" &&
    Number.isSafeInteger(row.revision) &&
    row.revision > 0 &&
    typeof row.senderId === "string"
  );
}

// Corpus build cache: rebuilding searchable text on every render would redo
// thousands of decryptor lookups per keystroke. Cached by message-list
// identity plus decryptor version, so repeat renders reuse the last build and
// each decrypt completion batch rebuilds exactly once. A WeakMap so discarded
// page arrays never pin memory.
const corpusCache = new WeakMap<
  readonly MessageData[],
  { corpus: SearchCandidate[]; version: number }
>();

// Snapshot selector for useSyncExternalStore: the searchable text of every
// loaded row, newest first. Reading the decryptor here (rather than in a memo
// over a ref) is what makes results reactive to decrypt completions and edits
// through the store subscription. Skips globally deleted placeholders and rows
// whose payload has not resolved yet; those join the corpus on a later
// version once their decrypt lands.
function getCorpusSnapshot(
  allMessages: readonly MessageData[]
): SearchCandidate[] {
  const version = messageDecryptor.getVersion();
  const cached = corpusCache.get(allMessages);
  if (cached && cached.version === version) {
    return cached.corpus;
  }
  const corpus: SearchCandidate[] = [];
  for (let index = allMessages.length - 1; index >= 0; index -= 1) {
    if (corpus.length >= MAX_RETAINED_SEARCH_PAGES * SEARCH_PAGE_SIZE) {
      break;
    }
    const message = allMessages[index];
    if (!message || message.deletedAt) {
      continue;
    }
    const entry = messageDecryptor.get(message.id);
    if (!entry || entry === "error" || entry === "pending") {
      continue;
    }
    const { text } = extractSearchableText(entry);
    if (text.trim().length === 0) {
      continue;
    }
    const createdAt = new Date(message.createdAt).getTime();
    corpus.push({
      createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
      id: message.id,
      text,
    });
  }
  corpusCache.set(allMessages, { corpus, version });
  return corpus;
}

// Full readable history is searched on the server; saved history stays bounded on the device.
export function useConversationSearch(
  input: ConversationSearchInput
): ConversationSearch {
  const {
    allMessages,
    conversationId,
    enabled,
    listPage = 0,
    offlineCacheRefreshToken = 0,
    offlineSearchScope = null,
    requestDecryptBatch,
    serverSearchEnabled = true,
    serverRefreshToken = 0,
  } = input;
  const decryptorVersion = useSyncExternalStore(
    messageDecryptor.subscribe,
    messageDecryptor.getVersion,
    messageDecryptor.getVersion
  );
  const offlineScopeKey = offlineSearchScope
    ? `${offlineSearchScope.userId}\u0000${offlineSearchScope.recoveryGeneration}`
    : "";
  const offlineScopeKeyRef = useRef("");
  const offlineIndexedRef = useRef(new Map<string, number>());
  const offlineCacheRefreshTokenRef = useRef<number | null>(null);
  const offlinePendingRef = useRef(new Set<string>());
  const offlineActivationRef = useRef<{
    key: string;
    promise: Promise<boolean>;
  } | null>(null);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [serverPageState, setServerPageState] = useState<ServerSearchPageState>(
    {
      key: "",
      pages: [],
      requestGeneration: 0,
      startPage: 0,
      summary: null,
    }
  );
  const [serverRequestGeneration, setServerRequestGeneration] = useState(0);
  const serverCoveragePollKeyRef = useRef("");
  const serverCoveragePollAttemptRef = useRef(0);
  const serverScopeRestartKeyRef = useRef("");
  const [serverRequest, setServerRequest] = useState<{
    error: string | null;
    key: string;
    loading: boolean;
  }>({ error: null, key: "", loading: false });
  const [serverCount, setServerCount] = useState<{
    count: number;
    key: string;
    state: "exact" | "unavailable";
  } | null>(null);
  useEffect(() => {
    const updateConnectivity = () => {
      setOnline(navigator.onLine);
      setServerPageState({
        key: "",
        pages: [],
        requestGeneration: 0,
        startPage: 0,
        summary: null,
      });
      setServerCount(null);
      setServerRequestGeneration((generation) => generation + 1);
    };
    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);
    return () => {
      window.removeEventListener("online", updateConnectivity);
      window.removeEventListener("offline", updateConnectivity);
    };
  }, []);

  useEffect(() => {
    if (!offlineSearchScope) {
      offlineScopeKeyRef.current = "";
      offlineActivationRef.current = null;
      offlineIndexedRef.current = new Map();
      offlinePendingRef.current = new Set();
      return;
    }
    if (offlineScopeKeyRef.current !== offlineScopeKey) {
      offlineScopeKeyRef.current = offlineScopeKey;
      offlineIndexedRef.current = new Map();
      offlinePendingRef.current = new Set();
      offlineActivationRef.current = {
        key: offlineScopeKey,
        promise: offlineSearchWorkerClient.activateScope(offlineSearchScope),
      };
    }
  }, [offlineScopeKey, offlineSearchScope]);

  useEffect(() => {
    if (!offlineSearchScope || !offlineScopeKey) {
      return;
    }
    const activation = offlineActivationRef.current;
    if (!activation || activation.key !== offlineScopeKey) {
      return;
    }
    if (offlineCacheRefreshTokenRef.current !== offlineCacheRefreshToken) {
      offlineCacheRefreshTokenRef.current = offlineCacheRefreshToken;
      offlineIndexedRef.current.clear();
    }
    const cacheRows = async () => {
      const messages: OfflineSearchWorkerMessage[] = [];
      const pending = offlinePendingRef.current;
      try {
        if (
          messageDecryptor.getVersion() < decryptorVersion ||
          !(await activation.promise) ||
          offlineScopeKeyRef.current !== offlineScopeKey
        ) {
          return;
        }
        const removals: string[] = [];
        const removalRules = [];
        for (const message of allMessages) {
          if (message.deletedAt) {
            removals.push(message.id);
            removalRules.push({
              id: message.id,
              revisionFloor: message.revision ?? null,
              sequence: null,
              unavailable: true,
            });
            continue;
          }
          const entry = messageDecryptor.get(message.id);
          if (!entry || entry === "error" || entry === "pending") {
            continue;
          }
          const revision = message.revision ?? 1;
          const existingRevision = offlineIndexedRef.current.get(message.id);
          if (existingRevision !== undefined && existingRevision >= revision) {
            continue;
          }
          if (pending.has(message.id)) {
            continue;
          }
          pending.add(message.id);
          messages.push({
            message: {
              ciphertext: message.ciphertext,
              conversationId,
              createdAt: message.createdAt,
              id: message.id,
              iv: message.iv,
              keyEpoch: message.keyEpoch ?? null,
              ratchetIndex: message.ratchetIndex,
              revision,
              senderId: message.senderId,
            },
            payload: entry,
          });
        }
        if (removals.length > 0) {
          await offlineSearchWorkerClient.remove(
            offlineSearchScope,
            conversationId,
            removals,
            removalRules
          );
        }
        if (messages.length === 0) {
          return;
        }
        const result = await offlineSearchWorkerClient.index({
          activeConversationId: conversationId,
          messages,
          scope: offlineSearchScope,
        });
        if (result.success && offlineScopeKeyRef.current === offlineScopeKey) {
          for (const item of messages) {
            rememberOfflineIndexedRevision(
              offlineIndexedRef.current,
              item.message.id,
              item.message.revision
            );
          }
        }
      } catch {
        // Offline cache failure must not affect transcript or online search.
      }
      for (const item of messages) {
        pending.delete(item.message.id);
      }
    };
    void cacheRows();
  }, [
    allMessages,
    conversationId,
    decryptorVersion,
    offlineCacheRefreshToken,
    offlineScopeKey,
    offlineSearchScope,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, query]);

  const serverSearchKey = `${conversationId}\u0000${debouncedQuery.trim()}\u0000${serverRefreshToken}\u0000${offlineScopeKey}\u0000${serverSearchEnabled}\u0000${online}`;
  useEffect(() => {
    const requestKey = serverSearchKey;
    const normalized = normalizeMessageSearchQuery(debouncedQuery);
    if (!enabled || !normalized.valid) {
      return;
    }
    const currentWindow =
      serverPageState.key === requestKey
        ? serverPageState
        : { pages: [], startPage: 0 };
    const summary =
      serverPageState.key === requestKey ? serverPageState.summary : null;
    const requestGenerationChanged =
      currentWindow.pages.length > 0 &&
      serverPageState.requestGeneration !== serverRequestGeneration;
    const pageRequest = searchResultPageRequest({
      pageIndex: listPage,
      refresh: requestGenerationChanged,
      window: currentWindow,
    });
    if (!pageRequest) {
      return;
    }
    const { pageIndex, cursor } = pageRequest;
    let cancelled = false;
    const controller = new AbortController();
    const loadNextPage = async () => {
      setServerRequest({ error: null, key: requestKey, loading: true });
      const savePage = (
        page: ServerSearchPage,
        index: number,
        reset = false
      ) => {
        setServerPageState((current) => {
          const window =
            current.key === requestKey && !reset
              ? current
              : { pages: [], startPage: 0 };
          return {
            ...retainSearchResultPage({ page, pageIndex: index, window }),
            key: requestKey,
            requestGeneration: serverRequestGeneration,
            summary: {
              ...searchPageSummary(page),
              countToken:
                page.countToken ??
                (!page.offline &&
                !reset &&
                current.key === requestKey &&
                current.summary?.snapshotToken === page.snapshotToken
                  ? (current.summary?.countToken ?? null)
                  : null),
            },
          };
        });
        if (page.totalMatches !== null) {
          setServerCount({
            count: page.totalMatches,
            key: `${requestKey}\u0000${page.snapshotToken ?? ""}\u0000${page.countToken ?? ""}`,
            state: "exact",
          });
        }
        setServerRequest({ error: null, key: requestKey, loading: false });
      };
      const readOfflinePage = async (
        boundary: string | null
      ): Promise<ServerSearchPage | null> => {
        if (!offlineSearchScope) {
          return null;
        }
        const activation = offlineActivationRef.current;
        if (
          !activation ||
          activation.key !== offlineScopeKey ||
          !(await activation.promise) ||
          cancelled
        ) {
          return null;
        }
        const decoded = decodeOfflineSearchCursor(boundary);
        let boundaryInput: {
          after?: NonNullable<typeof decoded>;
          before?: NonNullable<typeof decoded>;
        } = {};
        if (decoded) {
          boundaryInput =
            decoded.direction === "newer"
              ? { after: decoded }
              : { before: decoded };
        }
        const page = await offlineSearchWorkerClient.search({
          ...boundaryInput,
          conversationId,
          limit: SEARCH_PAGE_SIZE,
          query: debouncedQuery,
          scope: offlineSearchScope,
        });
        if (!page || cancelled) {
          return null;
        }
        return {
          countToken: null,
          coverageComplete: true,
          coveragePaused: false,
          coverageSettled: true,
          hitIds: page.hits.map((record) => record.id),
          hits: page.hits.map((record) =>
            offlineSearchRecordToMessageData(conversationId, record)
          ),
          nextCursor: encodeOfflineSearchCursor(page.nextCursor),
          offline: true,
          previousCursor: encodeOfflineSearchCursor(
            page.previousCursor,
            "newer"
          ),
          requestCursor: boundary,
          snapshotToken: null,
          totalMatches: page.totalMatches,
        };
      };
      const saveOfflinePages = async (): Promise<boolean> => {
        let boundary: string | null = null;
        let window: SearchResultWindow<ServerSearchPage> = {
          pages: [],
          startPage: 0,
        };
        let lastPage: ServerSearchPage | null = null;
        for (let index = 0; index <= pageIndex; index += 1) {
          if (
            cancelled ||
            controller.signal.aborted ||
            (index > 0 && !boundary)
          ) {
            break;
          }
          // oxlint-disable-next-line no-await-in-loop -- bounded saved-history pages depend on their predecessor's keyset
          const page = await readOfflinePage(boundary);
          if (!page) {
            return false;
          }
          window = retainSearchResultPage({ page, pageIndex: index, window });
          lastPage = page;
          boundary = page.nextCursor;
        }
        if (cancelled || !lastPage) {
          return false;
        }
        setServerPageState({
          ...window,
          key: requestKey,
          requestGeneration: serverRequestGeneration,
          summary: searchPageSummary(lastPage),
        });
        if (lastPage.totalMatches !== null) {
          setServerCount({
            count: lastPage.totalMatches,
            key: `${requestKey}\u0000${lastPage.snapshotToken ?? ""}\u0000${lastPage.countToken ?? ""}`,
            state: "exact",
          });
        }
        setServerRequest({ error: null, key: requestKey, loading: false });
        return true;
      };

      if ((!serverSearchEnabled || !online) && !summary?.offline) {
        if (await saveOfflinePages()) {
          return;
        }
        if (!cancelled) {
          setServerRequest({
            error: "Search could not load. Try again.",
            key: requestKey,
            loading: false,
          });
        }
        return;
      }
      if (summary?.offline && offlineSearchScope) {
        const page = await readOfflinePage(cursor);
        if (cancelled) {
          return;
        }
        if (page) {
          savePage(page, pageIndex);
        } else {
          setServerRequest({
            error: "Search could not load. Try again.",
            key: requestKey,
            loading: false,
          });
        }
        return;
      }
      try {
        const snapshot =
          pageIndex === 0 && requestGenerationChanged
            ? summary?.snapshotToken
            : undefined;
        const response = await fetch(
          `/api/messages/conversations/${encodeURIComponent(conversationId)}/search`,
          {
            body: JSON.stringify({
              ...(cursor ? { cursor } : {}),
              ...(snapshot ? { snapshot } : {}),
              query: debouncedQuery,
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          if (response.status === 409) {
            const payload: unknown = await response.json().catch(() => null);
            if (cancelled) {
              return;
            }
            if (isServerSearchScopeChanged(response.status, payload)) {
              if (
                shouldRestartAfterServerSearchScopeChange(
                  requestKey,
                  serverScopeRestartKeyRef.current
                )
              ) {
                serverScopeRestartKeyRef.current = requestKey;
                serverCoveragePollAttemptRef.current = 0;
                setServerCount(null);
                setServerPageState({
                  key: requestKey,
                  pages: [],
                  requestGeneration: serverRequestGeneration,
                  startPage: 0,
                  summary: null,
                });
                setServerRequestGeneration((generation) => generation + 1);
                setServerRequest({
                  error: null,
                  key: requestKey,
                  loading: false,
                });
                return;
              }
              if (!cancelled) {
                setServerRequest({
                  error: "Search could not load. Try again.",
                  key: requestKey,
                  loading: false,
                });
              }
              return;
            }
          }
          if (
            shouldUseOfflineSearchForStatus(response.status) &&
            (await saveOfflinePages())
          ) {
            return;
          }
          if (!cancelled) {
            setServerRequest({
              error: "Search could not load. Try again.",
              key: requestKey,
              loading: false,
            });
          }
          return;
        }
        const payload: unknown = await response.json();
        if (cancelled) {
          return;
        }
        if (typeof payload !== "object" || payload === null) {
          if (!cancelled) {
            setServerRequest({
              error: "Search could not load. Try again.",
              key: requestKey,
              loading: false,
            });
          }
          return;
        }
        const body = payload as Record<string, unknown>;
        const rawHits = body.hits;
        if (
          !Array.isArray(rawHits) ||
          rawHits.length > SEARCH_PAGE_SIZE ||
          typeof body.snapshotToken !== "string" ||
          body.snapshotToken.length === 0
        ) {
          if (!cancelled) {
            setServerRequest({
              error: "Search could not load. Try again.",
              key: requestKey,
              loading: false,
            });
          }
          return;
        }
        const searchHits = rawHits.filter(isSearchApiHit);
        if (searchHits.length !== rawHits.length) {
          if (!cancelled) {
            setServerRequest({
              error: "Search could not load. Try again.",
              key: requestKey,
              loading: false,
            });
          }
          return;
        }
        const hits = await hydrateSearchHits({
          conversationId,
          hits: searchHits,
          signal: controller.signal,
        });
        const { coverage } = body;
        const coverageState =
          typeof coverage === "object" && coverage !== null
            ? (coverage as Record<string, unknown>)
            : null;
        const coverageComplete = coverageState?.complete === true;
        const coverageSettled =
          coverageState?.settled === true || coverageComplete;
        const coveragePaused = coverageState?.paused === true;
        const nextCursor =
          typeof body.nextCursor === "string" ? body.nextCursor : null;
        const countToken =
          typeof body.countToken === "string" ? body.countToken : null;
        const totalMatches =
          typeof body.totalMatches === "number" &&
          Number.isSafeInteger(body.totalMatches) &&
          body.totalMatches >= 0
            ? body.totalMatches
            : null;
        const { snapshotToken } = body;
        if (!cancelled) {
          serverScopeRestartKeyRef.current = "";
          savePage(
            {
              countToken,
              coverageComplete,
              coveragePaused,
              coverageSettled,
              hitIds: hits.map((hit) => hit.id),
              hits,
              nextCursor,
              offline: false,
              previousCursor:
                typeof body.previousCursor === "string"
                  ? body.previousCursor
                  : null,
              requestCursor: cursor,
              snapshotToken,
              totalMatches,
            },
            pageIndex
          );
        }
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          if (await saveOfflinePages()) {
            return;
          }
          setServerRequest({
            error: "Search could not load. Try again.",
            key: requestKey,
            loading: false,
          });
        }
      }
    };
    void loadNextPage();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    conversationId,
    debouncedQuery,
    enabled,
    listPage,
    serverPageState,
    serverSearchEnabled,
    online,
    offlineScopeKey,
    offlineSearchScope,
    serverSearchKey,
    serverRequestGeneration,
  ]);

  const serverPages = useMemo(
    () =>
      serverPageState.key === serverSearchKey ? serverPageState.pages : [],
    [serverPageState, serverSearchKey]
  );
  const serverMessages = useMemo(
    () => serverPages.flatMap((page) => page.hits),
    [serverPages]
  );
  const serverSummary =
    serverPageState.key === serverSearchKey ? serverPageState.summary : null;
  const serverCountToken = serverSummary?.countToken ?? null;
  const serverCountKey = `${serverSearchKey}\u0000${serverSummary?.snapshotToken ?? ""}\u0000${serverCountToken ?? ""}`;
  useEffect(() => {
    if (!enabled || !serverCountToken) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let delayMs = 1000;
    let consecutiveFailures = 0;
    const stopUnavailable = () => {
      setServerCount({
        count: 0,
        key: serverCountKey,
        state: "unavailable",
      });
    };
    const pollCount = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/messages/conversations/${encodeURIComponent(conversationId)}/search/count`,
          {
            body: JSON.stringify({ token: serverCountToken }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal: controller.signal,
          }
        );
        if (cancelled) {
          return;
        }
        if (response.ok) {
          const payload: unknown = await response.json();
          if (cancelled) {
            return;
          }
          if (typeof payload === "object" && payload !== null) {
            const body = payload as Record<string, unknown>;
            if (
              body.state === "exact" &&
              typeof body.count === "number" &&
              Number.isSafeInteger(body.count) &&
              body.count >= 0
            ) {
              setServerCount({
                count: body.count,
                key: serverCountKey,
                state: "exact",
              });
              return;
            }
            if (body.state === "unavailable") {
              setServerCount({
                count: 0,
                key: serverCountKey,
                state: "unavailable",
              });
              return;
            }
            if (body.state === "pending") {
              consecutiveFailures = 0;
            } else {
              consecutiveFailures += 1;
            }
          } else {
            consecutiveFailures += 1;
          }
        } else if (response.status === 429) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            delayMs = Math.max(delayMs, Math.min(retryAfter * 1000, 60_000));
          }
        } else {
          consecutiveFailures += 1;
        }
      } catch {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        consecutiveFailures += 1;
      }
      if (consecutiveFailures >= 5) {
        stopUnavailable();
        return;
      }
      if (!cancelled) {
        timer = setTimeout(() => {
          timer = null;
          void pollCount();
        }, delayMs);
        delayMs = Math.min(delayMs * 2, 10_000);
      }
    };
    void pollCount();
    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      controller?.abort();
    };
  }, [conversationId, enabled, serverCountKey, serverCountToken]);

  const searchMessages = serverMessages;

  const retry = useCallback(() => {
    serverScopeRestartKeyRef.current = "";
    if (serverSummary?.offline && online) {
      setServerCount(null);
      setServerPageState({
        key: "",
        pages: [],
        requestGeneration: -1,
        startPage: 0,
        summary: null,
      });
    }
    setServerRequestGeneration((generation) => generation + 1);
  }, [online, serverSummary]);

  // Ask for decrypts of loaded rows the visible-window prefetcher never
  // reached. Requests are idempotent in the decryptor, and rows that resolve
  // join the corpus through the version-bumped snapshot below.
  useEffect(() => {
    if (!enabled || searchMessages.length === 0) {
      return;
    }
    const missing = searchMessages.filter(
      (message) =>
        !message.deletedAt && messageDecryptor.get(message.id) === undefined
    );
    if (missing.length > 0) {
      requestDecryptBatch(missing);
    }
  }, [enabled, requestDecryptBatch, searchMessages]);

  const getSnapshot = useCallback(
    () => (enabled ? getCorpusSnapshot(searchMessages) : EMPTY_CORPUS),
    [enabled, searchMessages]
  );
  const corpus = useSyncExternalStore(
    messageDecryptor.subscribe,
    getSnapshot,
    () => EMPTY_CORPUS
  );

  const corpusById = useMemo(() => {
    const map = new Map<string, SearchCandidate>();
    for (const candidate of corpus) {
      map.set(candidate.id, candidate);
    }
    return map;
  }, [corpus]);
  const matchIds = useMemo(
    () =>
      enabled ? serverMessages.map((message) => message.id) : EMPTY_MATCH_IDS,
    [enabled, serverMessages]
  );

  const serverPage =
    serverPageState.key === serverSearchKey
      ? searchResultPage(serverPageState, listPage)
      : null;
  const windowStartPage =
    serverPageState.key === serverSearchKey ? serverPageState.startPage : 0;
  const windowEndPage = windowStartPage + serverPages.length - 1;
  const canNextPage = Boolean(
    serverPage?.nextCursor || listPage < windowEndPage
  );
  const canPreviousPage = Boolean(
    listPage > 0 && (serverPage?.previousCursor || listPage > windowStartPage)
  );
  const pageHitIds =
    serverPage?.hitIds ?? serverPage?.hits.map((message) => message.id) ?? [];
  const serverOffline = serverSummary?.offline === true;
  const serverPageResults = useMemo(() => {
    if (!serverPage) {
      return [];
    }
    const candidates = serverPage.hits.flatMap((message) => {
      const candidate = corpusById.get(message.id);
      return candidate ? [candidate] : [];
    });
    const rankedById = new Map(
      buildRankedResults(
        scoreSearchCandidates(candidates, debouncedQuery),
        debouncedQuery
      ).map((result) => [result.id, result])
    );
    return serverPage.hits.flatMap((message) => {
      const result = rankedById.get(message.id);
      return result ? [result] : [];
    });
  }, [corpusById, debouncedQuery, serverPage]);
  const serverKnownHitCount =
    (serverPageState.key === serverSearchKey
      ? serverPageState.startPage * SEARCH_PAGE_SIZE
      : 0) + serverPages.reduce((count, page) => count + page.hits.length, 0);
  const lastServerPage = serverPages.at(-1);
  const serverCoverageUnavailable =
    enabled &&
    !serverOffline &&
    (serverSummary?.coverageSettled === true ||
      serverSummary?.coveragePaused === true) &&
    serverSummary?.coverageComplete === false;
  const serverCoverageIncomplete =
    enabled &&
    !serverOffline &&
    normalizeMessageSearchQuery(debouncedQuery).valid &&
    !serverCoverageUnavailable &&
    (serverPages.length === 0 || serverSummary?.coverageSettled !== true);
  const serverHasMore = serverSearchHasMore({
    nextCursor: lastServerPage?.nextCursor ?? null,
  });
  const serverExactCount =
    serverCount?.key === serverCountKey && serverCount.state === "exact"
      ? serverCount.count
      : null;
  const serverTotalMatches = serverExactCount ?? serverKnownHitCount;
  let serverCountState: ConversationSearch["countState"] = null;
  if (serverExactCount !== null) {
    serverCountState = "exact";
  } else if (
    serverCount?.key === serverCountKey &&
    serverCount.state === "unavailable"
  ) {
    serverCountState = "unavailable";
  } else if (serverCountToken) {
    serverCountState = "pending";
  }
  const serverRequestCurrent = serverRequest.key === serverSearchKey;
  const serverSearchError = serverRequestCurrent ? serverRequest.error : null;
  const serverSearchLoading = serverRequestCurrent && serverRequest.loading;
  const serverDecryptLoading = serverMessages.some(
    (message) => messageDecryptor.get(message.id) === "pending"
  );

  useEffect(() => {
    if (serverCoveragePollKeyRef.current !== serverSearchKey) {
      serverCoveragePollKeyRef.current = serverSearchKey;
      serverCoveragePollAttemptRef.current = 0;
    }
    const canPoll = shouldPollServerSearchCoverage({
      coverageComplete: serverSummary?.coverageComplete === true,
      coveragePaused: serverSummary?.coveragePaused === true,
      coverageSettled: serverSummary?.coverageSettled === true,
      hasPage: serverPages.length > 0,
      offline: serverOffline,
      queryValid: normalizeMessageSearchQuery(debouncedQuery).valid,
      requestError: Boolean(serverSearchError),
      requestLoading: serverSearchLoading,
      searchEnabled: enabled,
      serverMode: true,
    });
    if (!canPoll) {
      if (
        !serverCoverageIncomplete ||
        serverOffline ||
        serverSearchError ||
        !enabled
      ) {
        serverCoveragePollAttemptRef.current = 0;
      }
      return;
    }
    const delay = coverageRetryDelay(serverCoveragePollAttemptRef.current);
    const timer = setTimeout(() => {
      serverCoveragePollAttemptRef.current += 1;
      setServerRequestGeneration((generation) => generation + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [
    debouncedQuery,
    enabled,
    serverCoverageIncomplete,
    serverOffline,
    serverPages,
    serverSearchError,
    serverSearchKey,
    serverSearchLoading,
    serverSummary,
  ]);

  return {
    canNextPage,
    canPreviousPage,
    countState: serverCountState,
    debouncedQuery,
    listPageError: serverSearchError,
    listPageLoading:
      enabled &&
      (serverSearchLoading ||
        (Boolean(serverPage) && serverDecryptLoading) ||
        (listPage > 0 && !serverPage && !serverSearchError)),
    listPageStale: serverCoverageIncomplete,
    matchIds,
    offlineSearch: serverOffline && !online,
    pageHitIds,
    query,
    resultMessages: serverMessages,
    results: enabled ? serverPageResults : [],
    retry,
    savedHistorySearch: serverOffline,
    searchError: serverSearchError,
    searching: serverSearchLoading || serverDecryptLoading,
    serverCoverageIncomplete,
    serverCoverageUnavailable,
    serverHasMore,
    setQuery,
    totalMatches: serverTotalMatches,
    totalMatchesExact: serverExactCount !== null,
    truncated: false,
    windowEndPage,
    windowStartPage,
  };
}

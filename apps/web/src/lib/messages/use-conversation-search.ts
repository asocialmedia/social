"use client";

import type { MessageData } from "@asm/db";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { messageDecryptor } from "./decryptor";
import {
  extractSearchableText,
  findMatchingIds,
  MAX_SEARCH_INDEX_MESSAGES,
  normalizeSearchText,
  rankSearchResults,
  SEARCH_DEBOUNCE_MS,
  searchQueryTokens,
} from "./message-search";
import type { RankedSearchResult, SearchCandidate } from "./message-search";
import {
  intersectPostingLists,
  SEARCH_INDEX_QUERY_LIMIT,
} from "./search-index-format";
import type {
  SearchIndexRowLookup,
  SearchIndexStore,
} from "./search-index-format";

export interface ConversationSearchInput {
  allMessages: MessageData[];
  // Which conversation's index to read. Explicit rather than inferred from the
  // loaded rows, so an empty or swapped window can never read the wrong index.
  conversationId: string;
  // True while a search surface (inline bar or its result list) is open.
  // Paging, decrypt requests, and ranking all idle when false so a closed
  // search costs nothing.
  enabled: boolean;
  hasPreviousPage: boolean;
  isFetchingPreviousPage: boolean;
  // Serialized older-page loader from the thread (one page in flight at most).
  // Resolves with the newly prepended messages.
  loadOlderMessages: () => Promise<MessageData[]>;
  // Batch decrypt request for rows outside the thread's visible window.
  requestDecryptBatch: (messages: MessageData[]) => void;
  // The persistent per-conversation index, when one could be opened. Absent
  // means IndexedDB is unavailable and search falls back to loaded rows only.
  indexStore?: SearchIndexStore | null;
  // Bumped by the thread after a batch of index writes lands, so the row table
  // and posting lists are re-read and newly indexed history becomes findable.
  // Without this a write would sit in the store until the next search session.
  indexRefreshToken?: number;
}

export interface ConversationSearch {
  debouncedQuery: string;
  // Searchable (decrypted, non-empty) rows currently in memory.
  indexedCount: number;
  // Rows this device has covered with the persistent index, which is the honest
  // denominator for "how much of this conversation can search see".
  indexedTotal: number;
  indexing: boolean;
  // Every matching message id, newest first. Merges the persistent index with
  // rows decrypted this session, so it spans the whole conversation rather than
  // just the loaded window. Drives sequential in-chat navigation.
  matchIds: string[];
  query: string;
  results: RankedSearchResult[];
  setQuery: (query: string) => void;
  totalLoaded: number;
  // Total matches, which can exceed `matchIds` for a query matching more than
  // SEARCH_INDEX_QUERY_LIMIT messages. The bar's "n of N" counter uses this.
  totalMatches: number;
  truncated: boolean;
}

const EMPTY_CORPUS: SearchCandidate[] = [];
// Shared empty result for a closed search, so the common case allocates nothing
// and the inline bar's `matchIds` identity stays stable while idle.
const EMPTY_MATCH_IDS: string[] = [];

// The posting lists read for the current query, keyed by nothing: they are
// already the exact set for this query, and are only valid together with the row
// table they were interned against.
interface IndexQueryMatches {
  // Row facts for the capped match set only. Bounded by the query limit, so this
  // is the only index state a search session holds.
  rows: SearchIndexRowLookup;
  tokens: string[];
  totalMatched: number;
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
    if (corpus.length >= MAX_SEARCH_INDEX_MESSAGES) {
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

// Builds a list-view row for a match that exists only in the persistent index,
// with no decrypted row loaded to show a snippet from.
//
// The index deliberately stores ids and tokens only, never message text, so
// there is no snippet to render yet. Showing the tokens that matched is honest
// and still tells the reader what was found; the full text appears once the row
// is loaded (which the jump does). Rows already in memory are ranked normally
// above these.
function indexOnlyResult(
  id: string,
  createdAt: number,
  tokens: string[]
): RankedSearchResult {
  const text = tokens.join(" ");
  return {
    createdAt,
    firstMatchStart: 0,
    id,
    // No highlight ranges: the preview is the matched tokens themselves.
    ranges: [],
    score: 0,
    snippet: { offset: 0, text },
    text,
  };
}

// Live in-conversation search over the thread's own loaded history plus the
// persistent local index.
//
// Plaintext only ever exists on this device: the server stores ciphertext, so
// the corpus is built from the shared decryptor cache after local decryption,
// and older messages the user has already indexed are found through the
// inverted index rather than by loading their rows.
//
// The index is read in two pieces, and the split is the whole point: the row
// table (id and timestamp per message) is loaded once per session, while the
// keystroke path reads one small posting list per typed word. Loading every
// posting list up front cost 146MB of RAM on a 200k-message conversation.
export function useConversationSearch(
  input: ConversationSearchInput
): ConversationSearch {
  const {
    allMessages,
    conversationId,
    enabled,
    hasPreviousPage,
    indexRefreshToken,
    indexStore,
    isFetchingPreviousPage,
    loadOlderMessages,
    requestDecryptBatch,
  } = input;
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [indexedTotal, setIndexedTotal] = useState(0);
  const [indexMatches, setIndexMatches] = useState<IndexQueryMatches | null>(
    null
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, query]);

  // A read that started before a newer write is dropped on arrival, so a slow
  // load cannot land after the write it predates and hide the new entries.
  const latestTokenRef = useRef(indexRefreshToken ?? 0);
  useEffect(() => {
    latestTokenRef.current = indexRefreshToken ?? 0;
  }, [indexRefreshToken]);

  // One point read for the coverage count, so the bar can say how much of the
  // conversation this device has covered. This replaced a read of the whole row
  // table, which is what used to cost 76MB of memory on a 200k-message
  // conversation and scale with the conversation rather than the result.
  useEffect(() => {
    if (!enabled || !indexStore) {
      return;
    }
    const requestedAt = indexRefreshToken ?? 0;
    let cancelled = false;
    const load = async () => {
      try {
        const { indexedRowCount } = await indexStore.readStats(conversationId);
        if (!cancelled && requestedAt === latestTokenRef.current) {
          setIndexedTotal(indexedRowCount);
        }
      } catch {
        // Storage unavailable: search falls back to loaded rows only, and the
        // coverage label reads zero rather than a wrong number.
        if (!cancelled) {
          setIndexedTotal(0);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId, enabled, indexStore, indexRefreshToken]);

  // Read this query's posting lists. One point read per typed word, which is
  // cheap enough to redo after every debounce; a whole-index load is not.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!enabled || !indexStore || trimmed.length === 0) {
      // Left as-is rather than cleared: the merge below ignores a stale set
      // whenever the query is empty, and a few posting lists are not worth a
      // render to release.
      return;
    }
    const tokens = searchQueryTokens(normalizeSearchText(trimmed));
    if (tokens.length === 0) {
      return;
    }
    // A read that predates a newer write is dropped on arrival, so a slow read
    // cannot land after the write it predates and hide the new entries.
    const requestedAt = indexRefreshToken ?? 0;
    let cancelled = false;
    const load = async () => {
      try {
        const lists = await Promise.all(
          tokens.map((token) =>
            indexStore.readPostingList(conversationId, token)
          )
        );
        // Intersect first, then resolve only the rows that survived. Doing it in
        // this order is the whole point: the rows are not known until the
        // intersection is done, so resolving first meant resolving the entire
        // conversation.
        const { rows, totalMatched } = intersectPostingLists(
          lists,
          SEARCH_INDEX_QUERY_LIMIT
        );
        const resolved = await indexStore.readRows(
          conversationId,
          Uint32Array.from(rows)
        );
        if (!cancelled && requestedAt === latestTokenRef.current) {
          setIndexMatches({ rows: resolved, tokens, totalMatched });
        }
      } catch {
        if (!cancelled) {
          setIndexMatches(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [conversationId, debouncedQuery, enabled, indexRefreshToken, indexStore]);

  // Walk older history one page per effect run while the dialog is open. The
  // length dependency re-arms the effect after every prepend, so a long thread
  // indexes progressively without ever holding more than one fetch in flight.
  // Serialization lives in loadOlderMessages (shared with the media viewer's
  // loader), so this never races the transcript auto-loader's cursor.
  const loadedCount = allMessages.length;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (!hasPreviousPage || loadedCount >= MAX_SEARCH_INDEX_MESSAGES) {
      return;
    }
    if (isFetchingPreviousPage) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const added = await loadOlderMessages();
      if (!cancelled && added.length > 0) {
        requestDecryptBatch(added);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    hasPreviousPage,
    isFetchingPreviousPage,
    loadedCount,
    loadOlderMessages,
    requestDecryptBatch,
  ]);

  // Ask for decrypts of loaded rows the visible-window prefetcher never
  // reached. Requests are idempotent in the decryptor, and rows that resolve
  // join the corpus through the version-bumped snapshot below.
  useEffect(() => {
    if (!enabled || allMessages.length === 0) {
      return;
    }
    const missing = allMessages.filter(
      (message) =>
        !message.deletedAt && messageDecryptor.get(message.id) === undefined
    );
    if (missing.length > 0) {
      requestDecryptBatch(missing);
    }
  }, [allMessages, enabled, requestDecryptBatch]);

  const getSnapshot = useCallback(
    () => (enabled ? getCorpusSnapshot(allMessages) : EMPTY_CORPUS),
    [allMessages, enabled]
  );
  const corpus = useSyncExternalStore(
    messageDecryptor.subscribe,
    getSnapshot,
    () => EMPTY_CORPUS
  );

  // Message id -> timestamp for the resolved matches, then overlaid with the
  // in-memory corpus. The corpus wins, because an edit's new timestamp is known
  // there before the index write lands. Bounded by the result cap: this used to
  // be built from the whole conversation's row table.
  const createdAtById = useMemo(() => {
    const byId = new Map<string, number>();
    for (const facts of indexMatches?.rows.values() ?? []) {
      byId.set(facts.messageId, facts.createdAt);
    }
    for (const candidate of corpus) {
      byId.set(candidate.id, candidate.createdAt);
    }
    return byId;
  }, [corpus, indexMatches]);

  // Merge the two sources of truth: the persistent inverted index (whole
  // conversation) and the rows decrypted this session (always current). The
  // memory side is authoritative for anything it knows about, because an edit is
  // visible there before the index write has flushed.
  const { matchIds, results, totalMatches } = useMemo(() => {
    const inMemoryIds = findMatchingIds(corpus, debouncedQuery);
    const ranked = rankSearchResults(corpus, debouncedQuery);
    if (!debouncedQuery.trim()) {
      return {
        matchIds: inMemoryIds,
        results: ranked,
        totalMatches: inMemoryIds.length,
      };
    }
    const seen = new Set(inMemoryIds);
    let indexIds: string[] = [];
    let indexOnlyTotal = 0;
    let matchedTokens: string[] = [];
    if (indexMatches) {
      // Reordered by timestamp here, now that the matched rows' facts are known.
      // The intersect could not do this: it does not know which rows will
      // survive, and resolving timestamps first is what used to force a
      // conversation-sized read.
      const ids = [...indexMatches.rows.values()]
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .map((facts) => facts.messageId)
        .filter((id) => !seen.has(id));
      indexIds = ids;
      // Rows held by memory are counted once. Overlap is only observable inside
      // the capped window, so a query matching far more than the cap can
      // over-count by the unseen overlap; it never under-counts.
      indexOnlyTotal = Math.max(
        0,
        indexMatches.totalMatched - (indexMatches.rows.size - ids.length)
      );
      matchedTokens = indexMatches.tokens;
    }

    const mergedIds = [...inMemoryIds, ...indexIds].toSorted(
      (left, right) =>
        (createdAtById.get(right) ?? 0) - (createdAtById.get(left) ?? 0)
    );

    // The ranked list leads with what can be shown in full; index-only hits
    // follow, in the same order the counter uses, so the two views agree.
    const withText = new Set(ranked.map((result) => result.id));
    const tail = indexIds
      .filter((id) => !withText.has(id))
      .map((id) =>
        indexOnlyResult(id, createdAtById.get(id) ?? 0, matchedTokens)
      );
    return {
      matchIds: mergedIds,
      results: [...ranked, ...tail],
      totalMatches: inMemoryIds.length + indexOnlyTotal,
    };
  }, [corpus, createdAtById, debouncedQuery, indexMatches]);

  const indexing =
    enabled && hasPreviousPage && loadedCount < MAX_SEARCH_INDEX_MESSAGES;
  const truncated =
    enabled && hasPreviousPage && loadedCount >= MAX_SEARCH_INDEX_MESSAGES;

  return {
    debouncedQuery,
    indexedCount: enabled ? corpus.length : 0,
    indexedTotal,
    indexing,
    matchIds: enabled ? matchIds : EMPTY_MATCH_IDS,
    query,
    results: enabled ? results : [],
    setQuery,
    totalLoaded: enabled ? loadedCount : 0,
    totalMatches: enabled ? totalMatches : 0,
    truncated,
  };
}

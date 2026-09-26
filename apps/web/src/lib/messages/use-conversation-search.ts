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
  MAX_SEARCH_INDEX_MESSAGES,
  MERGE_THROTTLE_MS,
  mergeSearchSnapshot,
  SEARCH_DEBOUNCE_MS,
  splitSearchTokens,
} from "./message-search";
import type {
  MergedSearchSnapshot,
  RankedSearchResult,
  SearchCandidate,
} from "./message-search";
import { SEARCH_INDEX_QUERY_LIMIT } from "./search-index-format";
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

  // One point read for the coverage count, so the bar can say how much of the
  // conversation this device has covered. This replaced a read of the whole row
  // table, which is what used to cost 76MB of memory on a 200k-message
  // conversation and scale with the conversation rather than the result.
  //
  // Not gated on the refresh token. Coverage is the one number that must track
  // indexing, and the read is a point read of the allocator, not a decrypt.
  useEffect(() => {
    if (!enabled || !indexStore) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { indexedRowCount } = await indexStore.readStats(conversationId);
        if (!cancelled) {
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
    // indexRefreshToken is a deliberate dependency. Every index commit bumps it,
    // and a coverage count that does not move when the index does is simply
    // wrong. The linter's heuristic assumes a dependency is read in the body,
    // which is not true of a re-read trigger.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- re-read on every commit
  }, [conversationId, enabled, indexStore, indexRefreshToken]);

  // Read this query's posting lists. One point read per typed word, which is
  // cheap enough to redo after every debounce; a whole-index load is not.
  //
  // The refresh token IS a trigger, and the reason it can be is that querying is
  // now cheap: one posting read per typed word plus a capped number of row reads,
  // all inside one consistent transaction. It used not to be followed, because a
  // query decrypted the whole sealed table and re-running it on every write meant
  // the tab decrypted the entire conversation continuously during a backfill.
  //
  // The version of this that refused to follow the token had a worse bug. It kept
  // a "drop a read that predates a write" guard, but the effect did not re-run on
  // a token bump -- so any write landing during an in-flight query discarded the
  // result with nothing scheduled to fetch it again, and the panel sat on
  // "Searching..." forever. Re-querying once per committed page is both correct
  // and affordable now.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!enabled || !indexStore || trimmed.length === 0) {
      // Left as-is rather than cleared: the merge below ignores a stale set
      // whenever the query is empty, and a few posting lists are not worth a
      // render to release.
      return;
    }
    // Finished words go exact; the word still being typed goes prefix, so
    // typing narrows live instead of flashing empty until the word completes.
    // splitSearchTokens needs the untrimmed text: only a trailing space marks
    // the last word finished.
    const { exact, prefix } = splitSearchTokens(debouncedQuery);
    if (exact.length === 0 && prefix === null) {
      return;
    }
    const tokens = prefix === null ? exact : [...exact, prefix];
    let cancelled = false;
    const load = async () => {
      try {
        // One call for the whole query, so the dictionary, the posting lists and
        // the rows are all read from a single consistent snapshot.
        const result = await indexStore.query(
          conversationId,
          exact,
          SEARCH_INDEX_QUERY_LIMIT,
          prefix === null ? undefined : { prefix }
        );
        if (!cancelled) {
          setIndexMatches({
            rows: result.rows,
            tokens,
            totalMatched: result.totalMatched,
          });
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
    // Deliberate, for the same reason as the coverage read above: results must
    // track the index, and a superseded load is already prevented by `cancelled`.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- re-query on every commit
  }, [conversationId, debouncedQuery, enabled, indexRefreshToken, indexStore]);

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

  // The two sources of truth, merged ONCE per consistent pair of inputs.
  //
  // The counter used to be a sum of two independently-moving terms: matches over
  // the loaded transcript, plus an index term corrected by an overlap estimate
  // that can only see inside the 2,000-row result cap. While history was still
  // loading, the transcript term slid as older pages pushed rows out of the
  // 3,000-row window, and the index term jumped on every flush -- so a static
  // query could report 269, then 316, then 289. Nothing was being deleted; the
  // sum was mixing windows evaluated at different times.
  //
  // The merge is a pure function of the corpus and ONE index snapshot, so a given
  // pair of inputs yields one number. It can still grow as coverage lands, which
  // is real, but it cannot wobble for a reason the reader cannot see. It also
  // scores the corpus once, instead of normalizing and scoring every row twice per
  // keystroke.
  //
  const fresh = useMemo(
    () =>
      mergeSearchSnapshot({
        corpus,
        index: indexMatches,
        query: debouncedQuery,
      }),
    [corpus, debouncedQuery, indexMatches]
  );
  // Sticky navigation ids and counter for the current query: ids never drop
  // and the total never drops while the query stands, so arrows never yank
  // and the counter never wobbles mid-indexing. Folded here rather than
  // rendered because the fold needs the previously committed snapshot.
  //
  // Cadence is bounded and that bound is load-bearing. The fold inputs churn
  // dozens of times per second during decrypt storms (measured: 87
  // recomputes/sec), and applying every one schedules a render per churn
  // event -- under a storm that render cascade trips React's nested-update
  // guard. So: a new query applies immediately (typing must feel live), and
  // same-query churn folds at most every MERGE_THROTTLE_MS via a trailing
  // timer. Either way the merge itself is idempotent, so repeats converge.
  const [sticky, setSticky] = useState<{
    query: string;
    snapshot: MergedSearchSnapshot;
  } | null>(null);
  const appliedQueryRef = useRef<string | null>(null);
  const lastFoldRef = useRef(0);
  const foldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestInputsRef = useRef({
    corpus,
    indexMatches,
    query: debouncedQuery,
  });
  useEffect(() => {
    latestInputsRef.current = {
      corpus,
      indexMatches,
      query: debouncedQuery,
    };
    if (appliedQueryRef.current !== debouncedQuery) {
      // New query (or first run): apply now, cancel any trailing fold for the
      // previous one, and restart the throttle window.
      if (foldTimerRef.current !== null) {
        clearTimeout(foldTimerRef.current);
        foldTimerRef.current = null;
      }
      appliedQueryRef.current = debouncedQuery;
      lastFoldRef.current = Date.now();
      const latest = latestInputsRef.current;
      // oxlint-disable-next-line react/set-state-in-effect -- folding a stream into sticky state needs the previously committed snapshot; converges immediately, one render
      setSticky((prev) => ({
        query: latest.query,
        snapshot: mergeSearchSnapshot(
          {
            corpus: latest.corpus,
            index: latest.indexMatches,
            query: latest.query,
          },
          prev && prev.query === latest.query ? prev.snapshot : null
        ),
      }));
      return;
    }
    if (Date.now() - lastFoldRef.current >= MERGE_THROTTLE_MS) {
      lastFoldRef.current = Date.now();
      const latest = latestInputsRef.current;
      // oxlint-disable-next-line react/set-state-in-effect -- same-query churn fold, throttled; converges, one render per window
      setSticky((prev) => ({
        query: latest.query,
        snapshot: mergeSearchSnapshot(
          {
            corpus: latest.corpus,
            index: latest.indexMatches,
            query: latest.query,
          },
          prev && prev.query === latest.query ? prev.snapshot : null
        ),
      }));
      return;
    }
    if (foldTimerRef.current === null) {
      foldTimerRef.current = setTimeout(() => {
        foldTimerRef.current = null;
        lastFoldRef.current = Date.now();
        const latest = latestInputsRef.current;
        setSticky((prev) => ({
          query: latest.query,
          snapshot: mergeSearchSnapshot(
            {
              corpus: latest.corpus,
              index: latest.indexMatches,
              query: latest.query,
            },
            prev && prev.query === latest.query ? prev.snapshot : null
          ),
        }));
      }, MERGE_THROTTLE_MS);
    }
  }, [corpus, debouncedQuery, indexMatches]);
  useEffect(
    () => () => {
      if (foldTimerRef.current !== null) {
        clearTimeout(foldTimerRef.current);
      }
    },
    []
  );
  const { matchIds, ranked, totalMatches } =
    sticky && sticky.query === debouncedQuery ? sticky.snapshot : fresh;

  // Deliberately NO history loading here.
  //
  // This hook used to walk older pages on its own, re-arming after every load
  // until 3,000 messages were in memory. That was a feedback loop: each page
  // fetched, decrypted 500 messages, rebuilt the 3,000-row corpus and flushed
  // index writes, while the visible "Index older messages" walk did the same
  // thing at the same time and both competed for one IndexedDB write lock. The
  // symptom was a search box that flickered -- the corpus was replaced
  // underneath it, so the result list and the "n of N" counter changed on their
  // own, and the tab slowed down the longer a search stayed open.
  //
  // Coverage is now driven by the user: the explicit index button, and ordinary
  // history loads through the transcript's own scroll loader. Search reads what
  // exists, it does not go and get it. The bar already reports how much has been
  // covered, so a partial answer is an explicit one rather than a silent one.
  const loadedCount = allMessages.length;
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
    results: enabled ? ranked : [],
    setQuery,
    totalLoaded: enabled ? loadedCount : 0,
    totalMatches: enabled ? totalMatches : 0,
    truncated,
  };
}

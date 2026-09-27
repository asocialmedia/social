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
  buildPagedResults,
  extractSearchableText,
  MAX_SEARCH_INDEX_MESSAGES,
  MAX_SEARCH_RESULTS,
  MERGE_THROTTLE_MS,
  mergeSearchSnapshot,
  scoreSearchCandidates,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
  splitSearchTokens,
} from "./message-search";
import type {
  MergedSearchSnapshot,
  RankedSearchResult,
  SearchCandidate,
} from "./message-search";
import { SEARCH_INDEX_QUERY_LIMIT } from "./search-index-format";
import type {
  SearchIndexCursor,
  SearchIndexRowLookup,
  SearchIndexStore,
} from "./search-index-format";
import { decidePageRequest, headPageCursor } from "./search-page-refresh";

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
  // Which page of ranked results the list view is showing. Page 0 is the merged
  // head; pages above it are read from the index on demand, because the head is
  // capped by what the keystroke path can afford to resolve and a query matching
  // tens of thousands of messages must still be fully reachable by paging.
  // Ignored while the list view is closed, so a stale page costs nothing.
  listPage?: number;
}

export interface ConversationSearch {
  debouncedQuery: string;
  // Searchable (decrypted, non-empty) rows currently in memory.
  indexedCount: number;
  // Rows this device has covered with the persistent index, which is the honest
  // denominator for "how much of this conversation can search see".
  indexedTotal: number;
  indexing: boolean;
  // True while an on-demand page window is in flight. The list shows this so a
  // page turn is visibly a read rather than an instant empty page.
  listPageLoading: boolean;
  // The last page window that failed to load. Rendering this is what keeps a
  // failed read retryable instead of leaving a blank page.
  listPageError: string | null;
  // The current page's window was read at an index generation older than the
  // one on hand, so more matches for it may exist. This is the ONLY condition
  // under which "still indexing" is a truthful thing to say about a page.
  listPageStale: boolean;
  // Every matching message id, newest first. Merges the persistent index with
  // rows decrypted this session, so it spans the whole conversation rather than
  // just the loaded window. Drives sequential in-chat navigation.
  matchIds: string[];
  query: string;
  // The rows the list view should render: the merged head for page 0, or the
  // on-demand window for a deeper page.
  results: RankedSearchResult[];
  setQuery: (query: string) => void;
  totalLoaded: number;
  // Total matches, which can exceed `matchIds` for a query matching more than
  // SEARCH_INDEX_QUERY_LIMIT messages. The bar's "n of N" counter uses this.
  totalMatches: number;
  truncated: boolean;
}

const EMPTY_CORPUS: SearchCandidate[] = [];
// Floor between two on-demand page reads while the index is being written. A
// commit storm must not turn into a read storm; one re-read per window is enough
// to keep a page current, and the trailing tick guarantees it happens.
const PAGE_REFRESH_MIN_INTERVAL_MS = 400;
// Shared empty result for a closed search, so the common case allocates nothing
// and the inline bar's `matchIds` identity stays stable while idle.
const EMPTY_MATCH_IDS: string[] = [];

// The only two predecessor states the page-turn decision distinguishes. "loaded"
// folds into undefined, and so does a page that was never read: a page that
// produced a seam needs no explanation, and the seam itself is the answer.
function previousPageState(
  reads: ReadonlyMap<number, "failed" | "loaded" | "loading">,
  page: number
): "failed" | "loading" | undefined {
  const state = reads.get(page);
  return state === "loading" || state === "failed" ? state : undefined;
}

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

// One on-demand page window, resolved and ready to render.
interface PageWindow {
  // Where the page BELOW this one starts, in the index's (createdAt, row) order.
  // Null when the window came back empty, so a page past the last match cannot
  // silently re-serve the previous one.
  cursor: SearchIndexCursor | null;
  // Whether the index holds matches past this window, read from the same pass
  // that cut it. The pager uses this to stop without spending a speculative read
  // to discover there is nothing past the last page.
  hasMore: boolean;
  // The index generation this window was read at, so the UI can say "still
  // indexing" only while a newer generation exists that this window predates.
  indexToken: number;
  query: string;
  // The window's row facts, so the page renders from one read and so navigation
  // order can learn their timestamps. The rendered rows are derived from these
  // plus the corpus, not stored here.
  rows: SearchIndexRowLookup;
  // The tokens the window was matched on, for the highlight ranges.
  tokens: readonly string[];
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
    indexStore,
    listPage = 0,
    requestDecryptBatch,
  } = input;
  // A definite generation. The input treats it as optional so a caller with no
  // index wiring still compiles; for an on-demand page read it is load-bearing,
  // so a missing one is simply generation zero.
  const indexGeneration = input.indexRefreshToken ?? 0;
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [indexedTotal, setIndexedTotal] = useState(0);
  const [indexMatches, setIndexMatches] = useState<IndexQueryMatches | null>(
    null
  );
  const [pageWindow, setPageWindow] = useState<PageWindow | null>(null);
  const [pageWindowLoading, setPageWindowLoading] = useState(false);
  const [pageWindowError, setPageWindowError] = useState<string | null>(null);
  // The index generation each page's last completed read used, and when it ran.
  // A page read that is not allowed to follow commits is how "the list is empty
  // while indexing" happens: the window was read early in the walk, the walk
  // kept committing, and the page kept showing the answer to a question about
  // an index that no longer exists.
  const pageReadTokenRef = useRef<Map<number, number>>(new Map());
  const pageReadAtRef = useRef<Map<number, number>>(new Map());
  // Commits arrive far faster than a page turn is worth re-reading, so a page
  // that is already current is left alone until this much time has passed. The
  // trailing tick below is what brings it back, so a burst of commits costs one
  // re-read rather than one per commit.
  const [pageRefreshTick, setPageRefreshTick] = useState(0);
  const pageRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Keyset cursor per page: the oldest match that page ended on, in the index's
  // (createdAt, row) order. A stack rather than one cursor, because the pager
  // steps by one in either direction and going back must re-read the SAME rows
  // the same way, not a window offset applied to a different starting point.
  // Page 0 has no cursor: it is the merged head, and the head's oldest DISPLAYED
  // match is the keyset below it.
  const cursorsRef = useRef<Map<number, SearchIndexCursor>>(new Map());
  // Whether each page's own read found more matches past it. Kept beside the
  // cursors because it is what tells the pager "this is the last page" without a
  // read, and because it is the only thing that can end paging at a page which
  // came back empty.
  const pageHasMoreRef = useRef<Map<number, boolean>>(new Map());
  // How each page's own read ended. Needed because a missing cursor has two very
  // different causes -- the page before is still loading, or it failed -- and
  // the pager can only tell them apart by what the read did, not by the
  // absence of a boundary.
  const pageReadsRef = useRef<Map<number, "loading" | "loaded" | "failed">>(
    new Map()
  );
  // Bumped whenever any page records a boundary, so a page that turned before
  // the one it pages from finished re-runs instead of giving up.
  const [cursorEpoch, setCursorEpoch] = useState(0);
  // The query the boundaries on hand belong to. Page boundaries are only
  // meaningful within one query: a cursor carried across queries pages from the
  // wrong place and skips rows silently, so the keyset is re-seeded when this
  // changes. Checked in the read effect itself, which is the one that consumes
  // the boundaries, so the clear can never land after the read that needed it.
  const keysetSeedRef = useRef<string | null>(null);

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
  }, [conversationId, enabled, indexGeneration, indexStore]);

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
  }, [conversationId, debouncedQuery, enabled, indexGeneration, indexStore]);

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

  // One page window of index hits, for list pages past the head.
  //
  // The head query is capped by what the keystroke path can afford (row
  // resolution is ~250ms per 2,000 rows), so a query matching 24k messages could
  // only ever show its first 2,000. Paging reads the same intersection a page at
  // a time, which costs milliseconds, so every match is reachable.
  //
  // The keyset is the last row id of the PREVIOUS page, kept per page in a stack
  // so turning back re-reads the same rows rather than walking a new path. Page
  // 1 starts below the head's own last index row, which is what makes the seam
  // between head and page 1 exact: no duplicate, no skipped row.
  const corpusById = useMemo(() => {
    const map = new Map<string, SearchCandidate>();
    for (const candidate of corpus) {
      map.set(candidate.id, candidate);
    }
    return map;
  }, [corpus]);
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
      // The page-refresh trailer's own timer. It exists to re-read a page once
      // the floor has passed, and search may well be closed by then: left armed
      // it fires into a torn-down session and schedules a read nobody is waiting
      // for.
      if (pageRefreshTimerRef.current !== null) {
        clearTimeout(pageRefreshTimerRef.current);
        pageRefreshTimerRef.current = null;
      }
    },
    []
  );
  // One snapshot for everything the session shows. The head's rows, the counter
  // and the rows a deeper page may carry all have to come from the SAME fold:
  // reading the head from `sticky` and the extras from `fresh` let the two
  // disagree mid-churn, which is how a loaded match could appear on page 1 and
  // again on a deeper page.
  const { loadedMatchIds, matchIds, ranked, totalMatches } =
    sticky && sticky.query === debouncedQuery ? sticky.snapshot : fresh;
  // The ids page 0 actually displays, which is what a deeper page must not
  // repeat. Derived from the same slice the pager slices, not from a parallel
  // computation that can drift.
  const headShownIds = useMemo(
    () => new Set(ranked.slice(0, SEARCH_PAGE_SIZE).map((row) => row.id)),
    [ranked]
  );

  // The keyset boundary for page 1: the oldest match ALREADY SHOWN on page 0,
  // because the query walks older from there.
  //
  // This used to be the lowest row in the whole head window, which is wrong in a
  // way that only shows up once the two numbers differ. The head holds up to
  // SEARCH_INDEX_QUERY_LIMIT rows but displays SEARCH_PAGE_SIZE of them, so
  // hanging page 1 below the WINDOW skipped every match between the page-0 slice
  // and the end of the window -- up to two thousand messages, reachable from
  // nowhere, with the pager cheerfully offering pages that led only to empty ones.
  // Below the displayed slice instead, and the pages tile the match sequence.
  //
  // It also used to be a row id, which is not a position in time on this index --
  // see the ordering note on `selectNewestFirstWindow`. On a backfilled
  // conversation the newest matches hold the LOWEST row ids, so the boundary was
  // the top of the set and every page after the head came back empty. That is the
  // "page 1 is fine and page 2 shows nothing" report.
  const headCursor = useMemo(() => {
    if (!indexMatches) {
      return null;
    }
    // From the same slice the reader is looking at, so the boundary cannot drift
    // from what page 0 shows.
    return headPageCursor({
      shownMessageIds: headShownIds,
      windowRows: indexMatches.rows,
    });
  }, [headShownIds, indexMatches]);
  useEffect(() => {
    const seed = enabled ? `${conversationId}\u0000${debouncedQuery}` : null;
    if (keysetSeedRef.current !== seed) {
      keysetSeedRef.current = seed;
      // Before the guards below on purpose: page 0 renders the merged head, but
      // the next page turn pages from boundaries this query has to re-derive.
      cursorsRef.current.clear();
      pageHasMoreRef.current.clear();
      pageReadsRef.current.clear();
      pageReadTokenRef.current.clear();
      pageReadAtRef.current.clear();
      if (pageRefreshTimerRef.current !== null) {
        clearTimeout(pageRefreshTimerRef.current);
        pageRefreshTimerRef.current = null;
      }
    }
    // Only for pages past the head. Page 0 renders the merged snapshot, which
    // already carries the full text of loaded rows and the index's first window.
    if (!enabled || listPage <= 0 || !indexStore) {
      return;
    }
    const { exact, prefix } = splitSearchTokens(debouncedQuery);
    if (exact.length === 0 && prefix === null) {
      return;
    }
    const tokens = prefix === null ? exact : [...exact, prefix];
    // The whole sequencing rule, in one tested place. It used to live inline
    // here, which is where a cursor read from the wrong page, a shortcut that
    // trusted a stale verdict, and a "still loading" that turned into a dead end
    // were all invisible to the suite.
    const decision = decidePageRequest({
      // Page 1 hangs off the head's displayed boundary; deeper pages off the page
      // before them.
      afterMatch:
        listPage === 1
          ? headCursor
          : (cursorsRef.current.get(listPage - 1) ?? null),
      generation: indexGeneration,
      minIntervalMs: PAGE_REFRESH_MIN_INTERVAL_MS,
      now: Date.now(),
      page: listPage,
      previousHasMore: pageHasMoreRef.current.get(listPage - 1),
      previousReadGeneration: pageReadTokenRef.current.get(listPage - 1),
      // "loaded" is folded into undefined: the decision reads the state only to
      // tell a mid-read page from one that will never produce a seam.
      previousState: previousPageState(pageReadsRef.current, listPage - 1),
      readAt: pageReadAtRef.current.get(listPage),
      readGeneration: pageReadTokenRef.current.get(listPage),
      ready: true,
    });
    // Resolved out here rather than inside the read closure below: a narrowing
    // does not survive into a callback, and the cursor this read pages from must
    // be the one the decision chose, not one re-derived at the call site.
    const readAfterMatch =
      decision.kind === "read" ? (decision.afterMatch ?? null) : null;
    if (decision.kind === "skip" || decision.kind === "current") {
      return;
    }
    if (decision.kind === "await-previous") {
      // The page before is mid-read. Clicking faster than reads land is ordinary,
      // so this is a wait and not a failure -- an error here is what made fast
      // paging a dead end behind a retry nobody had broken.
      setPageWindowLoading(true);
      return;
    }
    if (decision.kind === "unreachable") {
      // The page before is not coming: it read as empty, or its read failed.
      setPageWindowError("This page could not be loaded. Go back and retry.");
      setPageWindowLoading(false);
      return;
    }
    if (decision.kind === "exhausted") {
      // Nothing past the previous page, from a read that is still current. The
      // page renders empty and the status says so, without a round trip.
      setPageWindowLoading(false);
      setPageWindowError(null);
      return;
    }
    if (decision.kind === "wait") {
      if (pageRefreshTimerRef.current !== null) {
        clearTimeout(pageRefreshTimerRef.current);
      }
      pageRefreshTimerRef.current = setTimeout(() => {
        pageRefreshTimerRef.current = null;
        setPageRefreshTick((tick) => tick + 1);
      }, decision.waitMs);
      return;
    }
    let cancelled = false;
    pageReadTokenRef.current.delete(listPage);
    pageReadsRef.current.set(listPage, "loading");
    setPageWindowLoading(true);
    setPageWindowError(null);
    const load = async () => {
      let result: Awaited<ReturnType<typeof indexStore.query>> | null = null;
      try {
        result = await indexStore.query(
          conversationId,
          exact,
          SEARCH_PAGE_SIZE,
          {
            ...(readAfterMatch ? { afterMatch: readAfterMatch } : {}),
            ...(prefix === null ? {} : { prefix }),
          }
        );
      } catch {
        pageReadTokenRef.current.delete(listPage);
        pageReadsRef.current.set(listPage, "failed");
        if (!cancelled) {
          setPageWindowLoading(false);
          setPageWindowError(
            "This page could not be loaded. Go back and retry."
          );
        }
        return;
      }
      // The oldest match in the window, which is the keyset for the page below.
      // Derived from the resolved facts rather than from row ids, because row ids
      // are allocation order on this index and the seam has to be a position in
      // TIME. The window arrives already ordered newest-first, so its last entry
      // is the oldest -- but it is picked by comparison rather than by position so
      // a backend that orders differently cannot silently produce a cursor that
      // points into the middle of the page.
      let oldest: SearchIndexCursor | null = null;
      for (const [row, facts] of result.rows) {
        const cursor: SearchIndexCursor = { createdAt: facts.createdAt, row };
        if (
          oldest === null ||
          cursor.createdAt < oldest.createdAt ||
          (cursor.createdAt === oldest.createdAt && cursor.row > oldest.row)
        ) {
          oldest = cursor;
        }
      }
      // The boundary is recorded even for a superseded read, because the page
      // the user is on now pages from THIS page's boundary. Dropping it on
      // cancellation is what stranded the next page with nothing to start from.
      // The wake is guarded on the boundary actually changing: bumping on every
      // read would re-run this effect on its own result and read the same page
      // forever.
      const recorded = cursorsRef.current.get(listPage);
      const sameCursor =
        recorded !== undefined &&
        oldest !== null &&
        recorded.createdAt === oldest.createdAt &&
        recorded.row === oldest.row;
      if (oldest === null) {
        // An empty window ends the paging: without a boundary the next page
        // would have nowhere to start from.
        if (recorded !== undefined) {
          cursorsRef.current.delete(listPage);
          pageHasMoreRef.current.delete(listPage);
          pageReadsRef.current.delete(listPage);
          setCursorEpoch((epoch) => epoch + 1);
        }
      } else if (!sameCursor) {
        cursorsRef.current.set(listPage, oldest);
        pageReadsRef.current.set(listPage, "loaded");
        setCursorEpoch((epoch) => epoch + 1);
      }
      pageHasMoreRef.current.set(listPage, result.hasMore);
      pageReadAtRef.current.set(listPage, Date.now());
      if (cancelled) {
        return;
      }
      // Recorded for a superseded read too: the boundary is this page's whether
      // or not the window is still wanted, and the generation is what the NEXT
      // reader compares against.
      pageReadTokenRef.current.set(listPage, indexGeneration);
      setPageWindow({
        cursor: oldest,
        hasMore: result.hasMore,
        indexToken: indexGeneration,
        query: debouncedQuery,
        rows: result.rows,
        tokens,
      });
      setPageWindowLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    // A re-run signal rather than a value the body reads: a boundary landing
    // under a page that is waiting for it is what brings this effect back, and
    // a ref write cannot trigger that on its own.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
    cursorEpoch,
    debouncedQuery,
    enabled,
    headCursor,
    // indexRefreshToken is a re-read trigger, not a value the body reads: an
    // on-demand page has to follow the index or it keeps answering a question
    // about a snapshot that has since moved.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
    indexGeneration,
    indexStore,
    listPage,
    // The trailing half of the throttle above: a page told to wait comes back
    // through a tick rather than by re-reading on the next commit.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
    pageRefreshTick,
  ]);

  // The window's rows, rendered. Derived rather than fetched, which is what
  // keeps the read keyed to the query and the page alone: the corpus snapshot
  // changes identity on every decrypt completion batch, so a corpus-keyed read
  // would re-query the index hundreds of times while a walk runs behind the page
  // the user is reading. Deriving instead means a row whose full text decrypts
  // after the window landed upgrades from its stored preview to the whole
  // message, with no read at all.

  // Loaded matches past the head's own display cap, so an index page can carry
  // them without re-walking the corpus.
  //
  // Two exclusions, both about never showing one message twice. The slice skips
  // the head's first MAX_SEARCH_RESULTS, which is exactly what page 0 displays;
  // and the head's DISPLAYED slice is excluded again below, because a folded
  // snapshot can rank a loaded row differently from the fresh one these come
  // from, and the row that moved down into the tail would otherwise appear on
  // page 0 and on a deeper page.
  const extraLoadedRows = useMemo(() => {
    if (debouncedQuery.trim().length === 0) {
      return [];
    }
    const beyond = loadedMatchIds.slice(MAX_SEARCH_RESULTS);
    if (beyond.length === 0) {
      return [];
    }
    const unseen = beyond.filter((id) => !headShownIds.has(id));
    if (unseen.length === 0) {
      return [];
    }
    const candidates: SearchCandidate[] = [];
    for (const id of unseen) {
      const candidate = corpusById.get(id);
      if (candidate) {
        candidates.push(candidate);
      }
    }
    if (candidates.length === 0) {
      return [];
    }
    // Scored here rather than reusing the head's pass: the head's rows are not
    // retained past `ranked`, and re-scoring a handful of rows is cheaper than
    // widening the snapshot to keep them. The page sorts them anyway, so the
    // scores only decide order within a tie.
    return scoreSearchCandidates(candidates, debouncedQuery);
  }, [corpusById, debouncedQuery, headShownIds, loadedMatchIds]);
  const pageWindowResults = useMemo(() => {
    if (!pageWindow) {
      return null;
    }
    return buildPagedResults({
      corpusById,
      extraLoaded: extraLoadedRows,
      query: pageWindow.query,
      rows: pageWindow.rows,
      tokens: pageWindow.tokens,
    });
  }, [corpusById, extraLoadedRows, pageWindow]);

  // Which rows the list view renders. Page 0 is the merged head; deeper pages are
  // the on-demand window, and only once it belongs to this query -- a window from
  // the previous query would show results for a query the user has left.
  const windowIsCurrent =
    pageWindow !== null && pageWindow.query === debouncedQuery;
  // A page that has not resolved yet renders nothing: showing the head's rows
  // relabelled as page N would put real messages under a false position, and
  // showing "no results" would contradict the counter. The loading and error
  // states below are what distinguish "not yet" from "nothing".
  let listResults = ranked;
  if (!enabled || (listPage > 0 && !windowIsCurrent)) {
    listResults = [];
  } else if (listPage > 0 && pageWindowResults) {
    listResults = pageWindowResults;
  }
  // A page turn past the head that has not resolved yet renders nothing rather
  // than the head's rows relabelled as page N.
  const listPageLoading =
    enabled && listPage > 0 && !windowIsCurrent && pageWindowLoading;
  const listPageError =
    enabled && listPage > 0 && !windowIsCurrent ? pageWindowError : null;
  const listPageStale =
    enabled &&
    listPage > 0 &&
    windowIsCurrent &&
    (pageWindow?.indexToken ?? indexGeneration) < indexGeneration;

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
    listPageError,
    listPageLoading,
    listPageStale,
    matchIds: enabled ? matchIds : EMPTY_MATCH_IDS,
    query,
    results: listResults,
    setQuery,
    totalLoaded: enabled ? loadedCount : 0,
    totalMatches: enabled ? totalMatches : 0,
    truncated,
  };
}

// Pure, UI-free helpers for in-conversation message search.
//
// Why search is client-side: the server stores only AES-GCM ciphertext, so it
// can never match plaintext. The thread pages history through the messages
// endpoint, decrypts locally via the shared decryptor, and ranks here. These
// helpers stay pure (no React, no decryptor) so they are unit-testable and
// reusable by any future surface (e.g. a cross-conversation index).

// Queries shorter than this never run: single characters match almost every
// row and would flash the whole thread on every keystroke.
export const MIN_SEARCH_QUERY_LENGTH = 2;
// Results kept for the ranked list view. The corpus can hold thousands of rows
// and every match is worth reaching, so the cap is set by what the paged list
// can usefully browse rather than by one screenful: at 20 rows a page this is
// 10 pages of history, and only the top slice is ever materialized with
// snippets (ranking below still pays just the match predicate).
export const MAX_SEARCH_RESULTS = 200;
// How many loaded messages one search session walks. Older history beyond the
// cap is left unindexed and reported as truncated in the UI. DMs rarely reach
// this, and the bound keeps decrypt + rank O(cap) instead of O(history).
export const MAX_SEARCH_INDEX_MESSAGES = 3000;
// Rows per page in the list view. Sized so a page fills roughly one screen on a
// phone and two on a desktop, while keeping every rendered snippet well inside
// the cheap-render budget. The pager itself lives in the search bar, so the
// list body is rows only.
export const SEARCH_PAGE_SIZE = 20;
// Keystroke debounce before a query runs against the corpus.
export const SEARCH_DEBOUNCE_MS = 150;
// Fastest the merged snapshot (navigation ids and counter) re-folds while one
// query's inputs churn underneath it. Decrypt storms change the inputs dozens
// of times per second; applying every change schedules a render per churn
// event, and under a storm that cascade trips React's nested-update guard.
// New queries bypass the throttle and apply immediately.
export const MERGE_THROTTLE_MS = 250;
// Characters of context kept on each side of the first match in a snippet.
export const SEARCH_SNIPPET_RADIUS = 60;
// Upper bound on highlighted ranges per result so a pathological
// single-character-token query cannot mint thousands of <mark> nodes.
export const MAX_SEARCH_RANGES = 10;

// Case- and diacritic-insensitive normalization shared by matching and token
// building. Display highlighting intentionally matches on the raw lowercased
// text instead (see findMatchRanges), so folded characters may simply go
// unmarked rather than misaligned.
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/g, "")
    .toLowerCase();
}

// Splits a normalized query into AND-ed tokens.
export function searchQueryTokens(normalizedQuery: string): string[] {
  return normalizedQuery.split(/\s+/).filter((token) => token.length > 0);
}

// Bounds for trailing-token prefix matching. Typing narrows live: the last
// token is matched by prefix so "zarq" already finds "zarquon", instead of
// flashing empty until the word is complete.
export const MIN_PREFIX_LENGTH = 2;
export const MAX_PREFIX_EXPANSION = 64;

export interface SplitSearchTokens {
  // Every token but the last: matched exactly, AND-ed as before.
  exact: string[];
  // The trailing token, matched by prefix -- null when the query ends in
  // whitespace (the word is finished, so everything is exact) or is empty.
  prefix: string | null;
}

// Splits a raw query the way the keystroke path needs it: completed words go
// exact, the word still being typed goes prefix. "deploy zarq" becomes
// exact ["deploy"] plus prefix "zarq"; "deploy " (trailing space) is all
// exact; "" is neither.
export function splitSearchTokens(query: string): SplitSearchTokens {
  const tokens = searchQueryTokens(normalizeSearchText(query));
  if (tokens.length === 0) {
    return { exact: [], prefix: null };
  }
  if (/\s$/.test(query)) {
    return { exact: tokens, prefix: null };
  }
  return { exact: tokens.slice(0, -1), prefix: tokens.at(-1) ?? null };
}

export type SearchableMessageKind = "media" | "post" | "text";

// The structural subset extraction needs. Deliberately looser than MessagePayload:
// the persistent index's writer sees a decrypted payload without the attachment
// and post references, and both paths must extract the SAME text, or a message
// would match before a reload and not after (or the reverse). A real
// MessagePayload satisfies this shape, so nothing is lost by widening it.
export interface SearchablePayload {
  content?: string;
  images?: number | readonly unknown[];
  kind?: "gif" | "image";
  type: SearchableMessageKind;
}

// The human-visible text a payload contributes to the index: the typed body
// for text, the caption plus a kind label otherwise. The label keeps
// captionless rows findable ("gif" matches a captionless GIF) without ever
// inventing body text that is not there.
//
// Shared by the ranked in-memory path and the persistent index writer. When the
// two disagreed, a captionless image was findable in the transcript and invisible
// after a reload, because the writer stored captions only and deliberately
// omitted the label.
export function extractSearchableText(payload: SearchablePayload): {
  kind: SearchableMessageKind;
  text: string;
} {
  if (payload.type === "text") {
    return { kind: "text", text: payload.content ?? "" };
  }
  if (payload.type === "post") {
    const label = "Shared a post";
    const caption = payload.content?.trim() ?? "";
    return {
      kind: "post",
      text: caption.length > 0 ? `${caption} ${label}` : label,
    };
  }
  // The attachment reference is absent from the writer's structural view, so the
  // count falls back to the single-image form rather than treating it as zero.
  const { images: attachmentCount } = payload;
  let images = 1;
  if (Array.isArray(attachmentCount)) {
    images = attachmentCount.length;
  } else if (typeof attachmentCount === "number") {
    images = attachmentCount;
  }
  let label: string;
  if (payload.kind === "gif") {
    label = "Shared a GIF";
  } else if (images > 1) {
    label = `Shared ${images} images`;
  } else {
    label = "Shared an image";
  }
  const caption = payload.content?.trim() ?? "";
  return {
    kind: "media",
    text: caption.length > 0 ? `${caption} ${label}` : label,
  };
}

// Scores a normalized haystack against already-tokenized query tokens, or null
// when any token is absent (AND semantics). Higher is better: an exact-phrase
// hit outranks scattered tokens, word-boundary hits outrank mid-word ones, and
// earlier first matches outrank later ones.
export function scoreSearchMatch(
  normalizedHaystack: string,
  tokens: string[],
  normalizedQuery: string
): number | null {
  if (tokens.length === 0) {
    return null;
  }
  let score = 0;
  let firstPosition = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const position = normalizedHaystack.indexOf(token);
    if (position === -1) {
      return null;
    }
    firstPosition = Math.min(firstPosition, position);
    score += isWordBoundaryMatch(normalizedHaystack, position, token.length)
      ? 2
      : 1;
  }
  if (
    normalizedQuery.length > 0 &&
    normalizedHaystack.includes(normalizedQuery)
  ) {
    score += 10;
  }
  // Earlier matches rank higher; the fraction keeps this strictly a tiebreak
  // below any whole-point difference.
  score += 1 / (1 + firstPosition);
  return score;
}

function isWordBoundaryMatch(
  haystack: string,
  position: number,
  length: number
): boolean {
  const before = haystack[position - 1];
  const after = haystack[position + length];
  return (
    (before === undefined || !isWordChar(before)) &&
    (after === undefined || !isWordChar(after))
  );
}

function isWordChar(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char);
}

export interface SearchMatchRange {
  end: number;
  start: number;
}

// Character ranges of every token occurrence inside the ORIGINAL text, for
// <mark> highlighting. Matching runs on the raw lowercased text (not the
// diacritic-folded form) so offsets always line up with what is rendered.
// Ranges are merged, sorted, and capped.
export function findMatchRanges(
  text: string,
  tokens: string[]
): SearchMatchRange[] {
  const lowered = text.toLowerCase();
  const ranges: SearchMatchRange[] = [];
  for (const token of tokens) {
    if (token.length === 0) {
      continue;
    }
    let from = 0;
    // oxlint-disable-next-line no-constant-condition -- bounded by the cap below, not the condition
    while (true) {
      const start = lowered.indexOf(token, from);
      if (start === -1 || ranges.length >= MAX_SEARCH_RANGES) {
        break;
      }
      ranges.push({ end: start + token.length, start });
      from = start + Math.max(token.length, 1);
    }
    if (ranges.length >= MAX_SEARCH_RANGES) {
      break;
    }
  }
  ranges.sort((left, right) => left.start - right.start);
  const merged: SearchMatchRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export interface SearchSnippet {
  // Offset of `text[0]` inside the original message text, so match ranges can
  // be rebased onto the snippet for rendering.
  offset: number;
  text: string;
}

// A window of context around the first match, with ellipsis markers implied by
// the offset/text length at render time (the dialog affixes "…" when the
// snippet is trimmed on either side).
export function buildSearchSnippet(
  text: string,
  firstMatchStart: number,
  radius = SEARCH_SNIPPET_RADIUS
): SearchSnippet {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return { offset: 0, text: "" };
  }
  const anchor = Math.min(Math.max(firstMatchStart, 0), collapsed.length);
  const start = Math.max(0, anchor - radius);
  // Bias the window toward the match: when the match is near the start, spend
  // the budget forward instead of centering.
  const end = Math.min(collapsed.length, start + radius * 2 + 20);
  return { offset: start, text: collapsed.slice(start, end) };
}

export interface SearchCandidate {
  createdAt: number;
  id: string;
  text: string;
}

export interface RankedSearchResult extends SearchCandidate {
  firstMatchStart: number;
  ranges: SearchMatchRange[];
  score: number;
  snippet: SearchSnippet;
}

// One pass over the corpus per query, shared by both surfaces.
//
// `rankSearchResults` and `findMatchingIds` used to each normalize and score
// every row independently, so one evaluation of a query against a 3,000-row
// transcript normalized every message body twice. That is a full extra pass over
// the whole corpus on the keystroke path. Evaluating once and deriving both
// answers from the same result also makes the ranked list and the "n of N"
// counter agree by construction rather than by two functions happening to share
// a predicate.
export interface ScoredSearchRow {
  candidate: SearchCandidate;
  firstMatchStart: number;
  score: number;
}

// Rows matching every token, ordered by score desc then newest first. The order
// is total, so the ranked list and the counter are two views of one list.
export function scoreSearchCandidates(
  candidates: readonly SearchCandidate[],
  query: string
): ScoredSearchRow[] {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
    return [];
  }
  const tokens = searchQueryTokens(normalizedQuery);
  const scored: ScoredSearchRow[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeSearchText(candidate.text);
    const score = scoreSearchMatch(normalized, tokens, normalizedQuery);
    if (score === null) {
      continue;
    }
    const firstMatchStart = normalized.indexOf(tokens[0] ?? "");
    scored.push({
      candidate,
      firstMatchStart: firstMatchStart === -1 ? 0 : firstMatchStart,
      score,
    });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.candidate.createdAt - left.candidate.createdAt;
  });
  return scored;
}

// Ranks candidates for one query: AND token match, score desc, then newest
// first, sliced to MAX_SEARCH_RESULTS. Snippet + ranges are computed only for
// survivors so a huge corpus never pays highlight costs for rows nobody sees.
export function rankSearchResults(
  candidates: SearchCandidate[],
  query: string
): RankedSearchResult[] {
  return buildRankedResults(scoreSearchCandidates(candidates, query), query);
}

// Materializes snippets and highlight ranges for already-scored rows. Split out
// from rankSearchResults so a caller that scored the corpus once for the counter
// can build the list from that same scoring without walking the corpus again.
export function buildRankedResults(
  scored: readonly ScoredSearchRow[],
  query: string
): RankedSearchResult[] {
  // Once per call, not once per row: normalizing the query inside the map would
  // reintroduce the per-row cost this function's refactor exists to remove.
  const tokens = searchQueryTokens(normalizeSearchText(query.trim()));
  return scored.slice(0, MAX_SEARCH_RESULTS).map((entry) => {
    const snippet = buildSearchSnippet(
      entry.candidate.text,
      entry.firstMatchStart
    );
    const ranges = findMatchRanges(entry.candidate.text, tokens)
      .map((range) => ({
        end: range.end - snippet.offset,
        start: range.start - snippet.offset,
      }))
      .filter((range) => range.end > 0 && range.start < snippet.text.length)
      .map((range) => ({
        end: Math.min(range.end, snippet.text.length),
        start: Math.max(range.start, 0),
      }));
    return {
      createdAt: entry.candidate.createdAt,
      firstMatchStart: entry.firstMatchStart,
      id: entry.candidate.id,
      ranges,
      score: entry.score,
      snippet,
      text: entry.candidate.text,
    };
  });
}

// One snapshot's worth of matches from the persistent index, as the hook holds it.
export interface IndexMatchSnapshot {
  // Message id -> facts, for the capped match set only.
  rows: ReadonlyMap<
    number,
    { createdAt: number; messageId: string; preview: string }
  >;
  tokens: readonly string[];
  totalMatched: number;
}

export interface MergedSearchSnapshot {
  // In-memory matches only, newest first, UNcapped. `ranked` is capped at
  // MAX_SEARCH_RESULTS, so this is the only place the loaded matches past that
  // cap are still addressable -- and while the persistent index is still
  // catching up, they exist nowhere else: an index-window page cannot see a row
  // the writer has not committed yet.
  loadedMatchIds: string[];
  // Every match id, newest first, for sequential navigation.
  matchIds: string[];
  // Message id -> timestamp for every id navigation knows. Timestamps ride
  // along across merges (createdAt never changes for a message), so replacing
  // the loaded window -- as every anchored jump does -- cannot demote ids the
  // new window no longer holds to the epoch and reshuffle navigation.
  createdAtById: Map<string, number>;
  // In-memory matches with snippets, then index-only matches, both already
  // ordered for display.
  ranked: RankedSearchResult[];
  // Index hits that no in-memory row accounts for, newest first.
  indexOnlyIds: string[];
  // The counter. A single number derived from ONE pair of inputs.
  totalMatches: number;
}

// Newest first, with the id as a deterministic tiebreak. Timestamp ties are
// real (same-millisecond messages), and without the tiebreak a tied block
// follows whatever input order the current window happened to arrive in --
// navigation positions inside the block would wander on every merge.
function compareMatchesNewestFirst(
  left: string,
  right: string,
  createdAtById: ReadonlyMap<string, number>
): number {
  const byTime =
    (createdAtById.get(right) ?? 0) - (createdAtById.get(left) ?? 0);
  if (byTime !== 0) {
    return byTime;
  }
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

// Merges the two sources of truth into one snapshot.
//
// Both terms used to be computed independently and added, which is what made the
// counter wander. The loaded-transcript term is a SLIDING window (older pages push
// rows out of it) and the index term jumps on every flush, so a static query could
// report 269, then 316, then 289 with nothing deleted. Making this a pure function
// of its two inputs means one snapshot is one number: it can still grow as
// coverage lands, but it cannot wobble for a reason the reader cannot see, and that
// property is testable without React.
//
// `prev` carries the previous snapshot for the SAME query, and makes two things
// sticky across recomputes. First, match ids never drop: during active indexing
// the capped index window slides and jumps replace the whole transcript window,
// so a match the user already landed on would vanish mid-session and the arrows
// would yank them back to the newest hit -- teleporting through random positions
// on every press. Second, the total never drops: the same churn that drops ids
// swings the count (31, then 23, then 31 again). Both stay monotonic for the
// session and reset on the next query. The price is explicit: a row hidden or
// deleted mid-search lingers in navigation and count until the query changes,
// which is strictly less wrong than teleporting through a live conversation.
// The displayed list (`ranked`) stays fresh -- only navigation and count stick.
export function mergeSearchSnapshot(
  input: {
    corpus: readonly SearchCandidate[];
    index: IndexMatchSnapshot | null;
    query: string;
  },
  prev: MergedSearchSnapshot | null = null
): MergedSearchSnapshot {
  const { corpus, index, query } = input;
  const scoredRows = scoreSearchCandidates(corpus, query);
  const inMemoryIds = scoredRowIdsNewestFirst(scoredRows);
  if (!query.trim()) {
    const createdAtById = new Map<string, number>();
    for (const row of scoredRows) {
      createdAtById.set(row.candidate.id, row.candidate.createdAt);
    }
    return {
      createdAtById,
      indexOnlyIds: [],
      loadedMatchIds: inMemoryIds,
      matchIds: inMemoryIds,
      ranked: [],
      totalMatches: inMemoryIds.length,
    };
  }
  const seen = new Set(inMemoryIds);
  // Timestamp facts for the capped index rows, so the merge can order them
  // without the intersect having to resolve the whole conversation.
  const createdAtById = new Map<string, number>();
  for (const row of scoredRows) {
    createdAtById.set(row.candidate.id, row.candidate.createdAt);
  }
  let indexOnlyIds: string[] = [];
  let indexOnlyTotal = 0;
  let matchedTokens: readonly string[] = [];
  // Stored previews for the capped index rows, so index-only hits render real
  // context instead of the matched tokens.
  const previewById = new Map<string, string>();
  if (index) {
    for (const facts of index.rows.values()) {
      if (!seen.has(facts.messageId)) {
        createdAtById.set(facts.messageId, facts.createdAt);
        previewById.set(facts.messageId, facts.preview);
      }
    }
    indexOnlyIds = [...index.rows.values()]
      .toSorted((left, right) => {
        if (right.createdAt !== left.createdAt) {
          return right.createdAt - left.createdAt;
        }
        if (left.messageId < right.messageId) {
          return -1;
        }
        return left.messageId > right.messageId ? 1 : 0;
      })
      .map((facts) => facts.messageId)
      .filter((id) => !seen.has(id));
    // Exact for the window that can be observed: the capped rows memory already
    // accounts for are subtracted, so the two sources are never double counted
    // there. Above the cap the overlap is genuinely unobservable, which the bar
    // communicates through its coverage wording rather than by inventing a number.
    indexOnlyTotal = Math.max(
      0,
      index.totalMatched - (index.rows.size - indexOnlyIds.length)
    );
    matchedTokens = index.tokens;
  }
  const freshIds = [...inMemoryIds, ...indexOnlyIds].toSorted((left, right) =>
    compareMatchesNewestFirst(left, right, createdAtById)
  );
  // Sticky navigation: union with the previous snapshot's ids so an id that
  // was reachable stays reachable for the session. Timestamps ride along from
  // the previous snapshot's own facts first (createdAt never changes for a
  // message, so there is nothing to conflict): the ranked display list is
  // truncated, so its scan alone forgets every in-memory hit past the cap,
  // and the next merge after a jump would otherwise demote those ids to the
  // epoch and teleport the counter to the end of the list. Fresh facts
  // overlay (same values), the ranked scan covers snapshots built without the
  // map, and the epoch fallback stays as a last resort a merge must never
  // lose navigation to a bookkeeping gap.
  const knownCreatedAt = new Map<string, number>(prev?.createdAtById);
  for (const [id, createdAt] of createdAtById) {
    knownCreatedAt.set(id, createdAt);
  }
  if (prev) {
    for (const row of prev.ranked) {
      if (!knownCreatedAt.has(row.id)) {
        knownCreatedAt.set(row.id, row.createdAt);
      }
    }
    for (const id of prev.matchIds) {
      if (!knownCreatedAt.has(id)) {
        // An id the previous display knew without facts (should not happen --
        // every match id ships inside ranked -- but a merge must never lose
        // navigation to a bookkeeping gap). Order it at the epoch start.
        knownCreatedAt.set(id, 0);
      }
    }
  }
  const matchIds = [
    ...new Set([...freshIds, ...(prev?.matchIds ?? [])]),
  ].toSorted((left, right) =>
    compareMatchesNewestFirst(left, right, knownCreatedAt)
  );
  // The list leads with rows that can be shown in full; index-only hits follow in
  // the same order the counter uses, so the two views agree. Deliberately NOT
  // sticky: the list shows what matches NOW, while navigation above stays put.

  // Bounded to the same MAX_SEARCH_RESULTS the corpus half is already bounded by,
  // and for the same reason. It used to be bounded only by the query limit -- up
  // to 2,000 rows -- so a common word on a fresh index materialized 2,000 snippets
  // and 2,000 highlight range sets on every fold. A fold runs at up to four per
  // second while a backfill is committing, which is 2,000 snippet builds per fold
  // of pure main-thread work for a list that displays twenty rows.
  //
  // Nothing observable depends on the tail being longer. Navigation reads
  // `matchIds` and `createdAtById`, both built from the full id set above; the
  // counter reads `index.totalMatched`; and the head renders the first
  // SEARCH_PAGE_SIZE rows. The head's displayed slice and its index boundary are
  // both derived from the first twenty rows, which this cap always covers.
  const tail = indexOnlyIds
    .slice(0, MAX_SEARCH_RESULTS)
    .map((id) =>
      indexOnlyResult(
        id,
        createdAtById.get(id) ?? 0,
        previewById.get(id) ?? "",
        matchedTokens
      )
    );
  const totalMatches = Math.max(
    prev?.totalMatches ?? 0,
    inMemoryIds.length + indexOnlyTotal
  );
  return {
    createdAtById: knownCreatedAt,
    indexOnlyIds,
    loadedMatchIds: inMemoryIds,
    matchIds,
    ranked: [...buildRankedResults(scoredRows, query), ...tail],
    totalMatches,
  };
}

// How many loaded matches a single index page may carry alongside its own
// window. Enough that a page is never empty while decoded matches exist, small
// enough that the keyset page keeps reading as a page.
const MAX_EXTRA_LOADED_PER_PAGE = 20;

// Builds the ranked rows for a list page that came from the index on demand,
// past the window the head snapshot could resolve.
//
// The head and a paged window are kept deliberately separate. The head merges
// the loaded transcript with the index's first window and keeps that logic in one
// place; a paged window holds index hits only, so this does the same per-row work
// the head does for its index tail (stored preview, real highlight ranges) and
// sorts the page by real timestamps before rendering.
//
// `corpus` supplies full text for rows the transcript happens to hold, so a page
// that lands on loaded messages shows the whole message rather than the stored
// prefix. That substitution is per page, not global: two passes would rank a
// loaded row differently from the identical row on the head page.
export function buildPagedResults(input: {
  // Message id -> decrypted text, for the loaded rows only.
  corpusById: ReadonlyMap<string, SearchCandidate>;
  // Loaded matches the head page cannot show, already scored against this
  // query. Undefined means "this page is index-only".
  //
  // The caller scores them separately rather than reusing the head's pass,
  // because the head's scored rows are truncated at MAX_SEARCH_RESULTS and only
  // what survives that cap is retained. Scored rows are ordered by the caller
  // anyway, so the scores only break ties within the page.
  //
  // These exist because an index window can only serve rows the writer has
  // committed, and the writer defers for the duration of a walk. On a device
  // that just started indexing, a query can match hundreds of DECRYPTED loaded
  // messages that no index page can return, so every one of them past the head's
  // own cap was previously unreachable -- the list offered a dozen pages of
  // nothing while the text sat in the transcript. Carrying them here is what
  // makes "clicking the list shows me the loaded messages with my query" true
  // while coverage is still partial.
  extraLoaded?: readonly ScoredSearchRow[];
  // The window's rows, as the store projected them.
  rows: ReadonlyMap<
    number,
    { createdAt: number; messageId: string; preview: string }
  >;
  query: string;
  tokens: readonly string[];
}): RankedSearchResult[] {
  const scored: ScoredSearchRow[] = [];
  const inWindow = new Set<string>();
  for (const facts of input.rows.values()) {
    const loaded = input.corpusById.get(facts.messageId);
    if (loaded) {
      // A row the transcript holds is scored by the same function the head uses,
      // so a loaded message ranks and snippets identically on either page.
      scored.push(...scoreSearchCandidates([loaded], input.query));
      continue;
    }
    const text = facts.preview;
    if (text.length === 0) {
      continue;
    }
    const ranges = findMatchRanges(text, [...input.tokens]);
    scored.push({
      candidate: {
        createdAt: facts.createdAt,
        id: facts.messageId,
        text,
      },
      firstMatchStart: ranges[0]?.start ?? 0,
      score: 0,
    });
  }
  for (const facts of input.rows.values()) {
    inWindow.add(facts.messageId);
  }
  // Taken after the window, and never in place of it: the keyset that produced
  // the window orders index rows alone, so the window stays the page's spine and
  // a loaded row cannot be spliced into a position whose boundary it would then
  // contradict. They are folded into the page's own newest-first order below, so
  // the page still reads as one list, and bounded so it cannot balloon.
  const extras = (input.extraLoaded ?? []).slice(0, MAX_EXTRA_LOADED_PER_PAGE);
  for (const entry of extras) {
    if (inWindow.has(entry.candidate.id)) {
      continue;
    }
    scored.push(entry);
  }
  // Newest first inside the page, with the same total order the head uses, so
  // turning a page never reorders rows relative to their neighbours.
  scored.sort((left, right) => {
    if (right.candidate.createdAt !== left.candidate.createdAt) {
      return right.candidate.createdAt - left.candidate.createdAt;
    }
    if (left.candidate.id < right.candidate.id) {
      return -1;
    }
    return left.candidate.id > right.candidate.id ? 1 : 0;
  });
  return buildRankedResults(scored, input.query);
}

// Builds a list-view row for a match that exists only in the persistent index,
// with no decrypted row loaded. The stored preview renders real context with
// real highlight ranges, computed exactly the way in-memory rows are ranked,
// so the two halves of the list are indistinguishable. A match past the stored
// prefix still resolves through the postings; its row shows the prefix without
// a highlight rather than match-centered context. Only an empty preview falls
// back to the matched tokens, and the full text appears once the row is loaded
// (which the jump does). Rows already in memory are ranked normally above these.
export function indexOnlyResult(
  id: string,
  createdAt: number,
  preview: string,
  tokens: readonly string[]
): RankedSearchResult {
  if (preview.length === 0) {
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
  const ranges = findMatchRanges(preview, [...tokens]);
  const firstMatchStart = ranges[0]?.start ?? 0;
  const snippet = buildSearchSnippet(preview, firstMatchStart);
  // Rebased onto the snippet, the same clipping buildRankedResults applies, so
  // the list's highlight renderer (which slices snippet text by these ranges)
  // never reads past the window.
  const rebased = ranges
    .map((range) => ({
      end: range.end - snippet.offset,
      start: range.start - snippet.offset,
    }))
    .filter((range) => range.end > 0 && range.start < snippet.text.length)
    .map((range) => ({
      end: Math.min(range.end, snippet.text.length),
      start: Math.max(range.start, 0),
    }));
  return {
    createdAt,
    firstMatchStart,
    id,
    ranges: rebased,
    score: 0,
    snippet,
    text: preview,
  };
}

// Matching message ids for one query, newest first, with no display cap and no
// scoring. This is the in-chat navigation corpus: unlike the ranked list view,
// every hit must be reachable by the up/down chevrons, so the Telegram-style
// counter reflects the true match count rather than the top N. Matches use the
// same AND-token predicate as rankSearchResults so both surfaces agree on what
// "a match" means.
export function findMatchingIds(
  candidates: SearchCandidate[],
  query: string
): string[] {
  return scoredRowIdsNewestFirst(scoreSearchCandidates(candidates, query));
}

// The same navigation ordering over rows the caller has already scored, so a
// caller that scored once for the counter does not walk the corpus again.
//
// Deliberately a separate function rather than an overloaded `findMatchingIds`:
// both shapes are arrays, so a runtime union check cannot tell a scored row from a
// candidate and silently scored the wrong thing.
export function scoredRowIdsNewestFirst(
  scored: readonly ScoredSearchRow[]
): string[] {
  return [...scored]
    .toSorted(
      (left, right) => right.candidate.createdAt - left.candidate.createdAt
    )
    .map((row) => row.candidate.id);
}

export interface SearchPage {
  // Clamped to a page that actually exists, so a shrinking result set (a
  // delete, a shorter query) can never strand the pager past the end.
  page: number;
  pageCount: number;
  pageResults: RankedSearchResult[];
  // 1-based inclusive bounds of the current page, for the bar's "1–20 of 87".
  rangeEnd: number;
  rangeStart: number;
}

// Slices one page out of the ranked results. Pure so the pager's edge cases
// (empty list, out-of-range page, non-integer page) are unit-tested rather than
// guarded ad hoc in the bar and the list.
//
// `totalCount` is the size of the whole result set, which is NOT
// `results.length` once results are paged: the hook holds one page at a time, so
// slicing the array would cap the pager at one page. Pass the exact count
// (SEARCH_INDEX_QUERY_LIMIT-independent: it is the full intersection) and the
// bounds describe a position in the conversation, not in the loaded rows.
//
// `pageResults` is still whatever the caller actually has for this page, so a
// page that has not been read yet yields an empty slice with honest bounds --
// the bar can show the range while the list shows its loading state.
export function paginateSearchResults(
  results: RankedSearchResult[],
  requestedPage: number,
  pageSize = SEARCH_PAGE_SIZE,
  totalCount = results.length
): SearchPage {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = Math.max(
    0,
    Math.trunc(Number.isFinite(totalCount) ? totalCount : 0)
  );
  const pageCount = Math.max(1, Math.ceil(total / size));
  const requested = Number.isFinite(requestedPage)
    ? Math.trunc(requestedPage)
    : 0;
  const page = Math.min(Math.max(requested, 0), pageCount - 1);
  const start = page * size;
  const end = Math.min(start + size, total);
  // The rows for this page are the ones the caller holds when it is holding this
  // page's slice. When the total exceeds the loaded rows (paging), the loaded
  // rows ARE the current page, so the page-relative offset is what applies.
  const pageOffset = total > results.length ? 0 : start;
  const rows = results.slice(pageOffset, pageOffset + size);
  const rangeStart = total === 0 ? 0 : start + 1;
  // The upper bound is the last row the page actually holds, not the last slot
  // its position allows: a sticky total that undercounts the real match set (the
  // last known count, kept while a fresh index read is in flight) would
  // otherwise print a range longer than the page, or a range the rows do not
  // fill. An empty page keeps its nominal position instead -- the window is
  // still on its way, and the bar says "loading" rather than a range.
  let rangeEnd = end;
  if (total > 0 && rows.length > 0) {
    rangeEnd = start + rows.length;
  } else if (total === 0) {
    rangeEnd = 0;
  }
  return {
    page,
    pageCount,
    pageResults: rows,
    rangeEnd,
    rangeStart,
  };
}

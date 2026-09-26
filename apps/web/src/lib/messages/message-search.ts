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
  rows: ReadonlyMap<number, { createdAt: number; messageId: string }>;
  tokens: readonly string[];
  totalMatched: number;
}

export interface MergedSearchSnapshot {
  // Every match id, newest first, for sequential navigation.
  matchIds: string[];
  // In-memory matches with snippets, then index-only matches, both already
  // ordered for display.
  ranked: RankedSearchResult[];
  // Index hits that no in-memory row accounts for, newest first.
  indexOnlyIds: string[];
  // The counter. A single number derived from ONE pair of inputs.
  totalMatches: number;
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
    return {
      indexOnlyIds: [],
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
  if (index) {
    for (const facts of index.rows.values()) {
      if (!seen.has(facts.messageId)) {
        createdAtById.set(facts.messageId, facts.createdAt);
      }
    }
    indexOnlyIds = [...index.rows.values()]
      .toSorted((left, right) => right.createdAt - left.createdAt)
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
  const freshIds = [...inMemoryIds, ...indexOnlyIds].toSorted(
    (left, right) =>
      (createdAtById.get(right) ?? 0) - (createdAtById.get(left) ?? 0)
  );
  // Sticky navigation: union with the previous snapshot's ids so an id that
  // was reachable stays reachable for the session. Timestamps ride along from
  // whichever side saw the id last (createdAt never changes for a message, so
  // there is nothing to conflict). Fresh ids order first on ties? No ties are
  // possible: one map, one order, newest first.
  const knownCreatedAt = new Map<string, number>(createdAtById);
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
  ].toSorted(
    (left, right) =>
      (knownCreatedAt.get(right) ?? 0) - (knownCreatedAt.get(left) ?? 0)
  );
  // The list leads with rows that can be shown in full; index-only hits follow in
  // the same order the counter uses, so the two views agree. Deliberately NOT
  // sticky: the list shows what matches NOW, while navigation above stays put.

  const tail = indexOnlyIds.map((id) =>
    indexOnlyResult(id, createdAtById.get(id) ?? 0, matchedTokens)
  );
  const totalMatches = Math.max(
    prev?.totalMatches ?? 0,
    inMemoryIds.length + indexOnlyTotal
  );
  return {
    indexOnlyIds,
    matchIds,
    ranked: [...buildRankedResults(scoredRows, query), ...tail],
    totalMatches,
  };
}

// Builds a list-view row for a match that exists only in the persistent index,
// with no decrypted row loaded to show a snippet from.
//
// The index deliberately stores ids and tokens only, never message text, so there
// is no snippet to render yet. Showing the tokens that matched is honest and still
// tells the reader what was found; the full text appears once the row is loaded
// (which the jump does). Rows already in memory are ranked normally above these.
export function indexOnlyResult(
  id: string,
  createdAt: number,
  tokens: readonly string[]
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
export function paginateSearchResults(
  results: RankedSearchResult[],
  requestedPage: number,
  pageSize = SEARCH_PAGE_SIZE
): SearchPage {
  const size = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(results.length / size));
  const requested = Number.isFinite(requestedPage)
    ? Math.trunc(requestedPage)
    : 0;
  const page = Math.min(Math.max(requested, 0), pageCount - 1);
  const start = page * size;
  const end = Math.min(start + size, results.length);
  return {
    page,
    pageCount,
    pageResults: results.slice(start, end),
    rangeEnd: end,
    rangeStart: results.length === 0 ? 0 : start + 1,
  };
}

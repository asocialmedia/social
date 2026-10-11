// Pure, UI-free helpers for in-conversation message search. Client-side because
// the server stores only ciphertext. No React, no decryptor, so unit-testable.

// Queries below this never run: single characters match almost every row.
export const MIN_SEARCH_QUERY_LENGTH = 2;
// Ranked list cap: 10 pages at 20 rows. Only the top slice materializes
// snippets; ranking below pays just the match predicate.
export const MAX_SEARCH_RESULTS = 200;
// Per-session walk cap. Keeps decrypt + rank O(cap) instead of O(history).
export const MAX_SEARCH_INDEX_MESSAGES = 3000;
// Rows per page in the list view.
export const SEARCH_PAGE_SIZE = 20;
// Keystroke debounce before a query runs.
export const SEARCH_DEBOUNCE_MS = 150;
// Fastest the merged snapshot re-folds while one query's inputs churn.
// Decrypt storms apply dozens of updates/sec; new queries bypass the throttle.
export const MERGE_THROTTLE_MS = 250;
// Context kept each side of the first match in a snippet.
export const SEARCH_SNIPPET_RADIUS = 60;
// Cap on highlight ranges per result.
export const MAX_SEARCH_RANGES = 10;

// Case- and diacritic-insensitive normalization. Highlighting matches raw
// lowercase instead, so folded characters may go unmarked rather than misalign.
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

// Bounds for trailing-token prefix matching: typing narrows live, so "zarq"
// already finds "zarquon".
export const MIN_PREFIX_LENGTH = 2;
export const MAX_PREFIX_EXPANSION = 64;

export interface SplitSearchTokens {
  // Every token but the last, matched exactly and AND-ed.
  exact: string[];
  // The trailing token, matched by prefix -- null when the query ends in
  // whitespace (the word is finished) or is empty.
  prefix: string | null;
}

// Completed words go exact, the word still being typed goes prefix: "deploy
// zarq" becomes exact ["deploy"] plus prefix "zarq"; "deploy " is all exact.
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

// The structural subset extraction needs: deliberately looser than
// MessagePayload, because the index writer sees a decrypted payload without
// attachment/post references and both paths must extract the SAME text or a
// message matches before a reload and not after.
export interface SearchablePayload {
  content?: string;
  images?: number | readonly unknown[];
  kind?: "gif" | "image";
  type: SearchableMessageKind;
}

// The human-visible text a payload contributes: the typed body for text, the
// caption plus a kind label otherwise. The label keeps captionless rows
// findable ("gif" matches a captionless GIF) without inventing body text.
//
// Shared by the ranked in-memory path and the index writer: when they
// disagreed, a captionless image was findable in the transcript and invisible
// after a reload.
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
  // The attachment reference is absent from the writer's structural view, so
  // the count falls back to the single-image form.
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
// when any token is absent (AND). Exact phrases outrank scattered tokens,
// word boundaries outrank mid-word, earlier first matches rank higher.
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
  // Earlier matches rank higher; the fraction is strictly a tiebreak.
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
// <mark> highlighting. Runs on raw lowercase (not diacritic-folded) so offsets
// line up with what is rendered. Merged, sorted, capped.
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

// A window of context around the first match. Ellipsis markers are implied by
// the offset/text length at render time.
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
  // Bias the window toward the match: spend the budget forward when it is near
  // the start instead of centering.
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

// One pass over the corpus per query, shared by both surfaces. Deriving the
// ranked list and the "n of N" counter from the same scoring makes them agree
// by construction instead of by two functions happening to share a predicate.
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

// Materializes snippets and highlight ranges for already-scored rows, so a
// caller that scored once for the counter does not walk the corpus again.
export function buildRankedResults(
  scored: readonly ScoredSearchRow[],
  query: string
): RankedSearchResult[] {
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
  // In-memory matches only, newest first, UNcapped. While the index is still
  // catching up, matches past `ranked`'s cap exist nowhere else.
  loadedMatchIds: string[];
  // Every match id, newest first, for sequential navigation.
  matchIds: string[];
  // Message id -> timestamp for every id navigation knows. Timestamps ride
  // across merges (createdAt never changes), so replacing the loaded window
  // cannot demote ids the new window no longer holds.
  createdAtById: Map<string, number>;
  // In-memory matches with snippets, then index-only matches.
  ranked: RankedSearchResult[];
  // Index hits that no in-memory row accounts for, newest first.
  indexOnlyIds: string[];
  // The counter, derived from ONE pair of inputs.
  totalMatches: number;
}

// Newest first, with the id as a deterministic tiebreak. Timestamp ties are
// real (same-millisecond sends), and without the tiebreak a tied block follows
// whatever input order the current window arrived in.
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
// A pure function of corpus + ONE index snapshot, so one snapshot is one
// number: it can grow as coverage lands, but it cannot wobble for a reason the
// reader cannot see (the previous sum of two independently-moving terms could
// report 269, then 316, then 289 with nothing deleted).
//
// `prev` is the previous snapshot for the SAME query and makes two things
// sticky: match ids never drop (an id already landed on would otherwise vanish
// mid-indexing and teleport the arrows on every press), and the total never
// drops (the same churn swings the count back and forth). Both stay monotonic
// for the session and reset on the next query. The price is explicit: a row
// hidden or deleted mid-search lingers in navigation and count until the query
// changes, which is strictly less wrong than teleporting through a live
// conversation. The displayed list (`ranked`) stays fresh.
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
    // Exact for the observable window: the capped rows memory accounts for
    // are subtracted so the two sources are never double counted there.
    // Above the cap the overlap is unobservable; the bar communicates that
    // through its coverage wording rather than by inventing a number.
    indexOnlyTotal = Math.max(
      0,
      index.totalMatched - (index.rows.size - indexOnlyIds.length)
    );
    matchedTokens = index.tokens;
  }
  const freshIds = [...inMemoryIds, ...indexOnlyIds].toSorted((left, right) =>
    compareMatchesNewestFirst(left, right, createdAtById)
  );
  // Sticky navigation: union with the previous snapshot so an id that was
  // reachable stays reachable. Facts ride from prev first (createdAt never
  // changes, so nothing conflicts), then fresh overlay, then the ranked scan
  // (the display list is truncated, so its scan alone forgets in-memory hits
  // past the cap), with the epoch fallback as a last resort so navigation
  // never loses to a bookkeeping gap.
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
        // Should not happen (every match id ships inside ranked); order it at
        // the epoch start so a bookkeeping gap still orders somewhere.
        knownCreatedAt.set(id, 0);
      }
    }
  }
  const matchIds = [
    ...new Set([...freshIds, ...(prev?.matchIds ?? [])]),
  ].toSorted((left, right) =>
    compareMatchesNewestFirst(left, right, knownCreatedAt)
  );
  // The list leads with rows shown in full, index-only hits following the
  // counter's order, so the two views agree. Deliberately NOT sticky: the list
  // shows what matches NOW; only navigation above stays put.
  //
  // Capped at MAX_SEARCH_RESULTS like the corpus half. Nothing observable
  // depends on the tail being longer: navigation reads `matchIds`/`createdAtById`
  // (built from the full id set), the counter reads `index.totalMatched`, and
  // the head renders plus boundaries its first twenty rows. It used to be capped
  // only by the query limit, so a common word on a fresh index materialized
  // 2,000 snippets per fold of pure main-thread work for a list showing twenty.
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
// The head merges the loaded transcript with the index's first window; a paged
// window holds index hits only, so this does the same per-row work the head
// does for its index tail (stored preview, real highlight ranges) and sorts the
// page by real timestamps before rendering.
//
// `corpusById` supplies full text for rows the transcript holds, so a page that
// lands on loaded messages shows the whole message rather than the stored
// prefix. Per page, not global: two passes would rank a loaded row differently
// from the identical row on the head page.
export function buildPagedResults(input: {
  // Message id -> decrypted text, for the loaded rows only.
  corpusById: ReadonlyMap<string, SearchCandidate>;
  // Loaded matches the head page cannot show, already scored against this
  // query. Undefined means "this page is index-only".
  //
  // Scored separately because the head's scored rows are truncated at
  // MAX_SEARCH_RESULTS. Needed at all because an index window only serves
  // committed rows and the writer defers during a walk: a freshly indexing
  // device can match hundreds of decrypted loaded messages no index page can
  // return, and without these they were unreachable while the text sat in the
  // transcript.
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
      // Scored by the same function the head uses, so a loaded message ranks
      // and snippets identically on either page.
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
  // Taken after the window, never in place of it: the keyset that produced the
  // window orders index rows alone, so the window stays the page's spine and a
  // loaded row cannot be spliced into a position its boundary would contradict.
  // Folded into the page's newest-first order below, bounded so it cannot balloon.
  const extras = (input.extraLoaded ?? []).slice(0, MAX_EXTRA_LOADED_PER_PAGE);
  for (const entry of extras) {
    if (inWindow.has(entry.candidate.id)) {
      continue;
    }
    scored.push(entry);
  }
  // Newest first with the head's total order, so turning a page never
  // reorders rows relative to their neighbours.
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

// A list-view row for a match that exists only in the persistent index, with no
// decrypted row loaded. The stored preview renders real context with real
// highlight ranges computed the way in-memory rows are ranked, so the two
// halves of the list are indistinguishable. A match past the stored prefix still
// resolves through the postings; its row shows the prefix without a highlight
// rather than match-centered context. Only an empty preview falls back to the
// matched tokens; full text appears once the row is loaded (which the jump does).
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
  // Rebased onto the snippet with buildRankedResults' clipping, so the
  // highlight renderer (which slices snippet text by these ranges) never reads
  // past the window.
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

// Matching message ids for one query, newest first: no display cap and no
// scoring. This is the in-chat navigation corpus -- every hit must be reachable
// by the chevrons, so the counter reflects the true match count rather than the
// top N. Uses the same AND-token predicate as rankSearchResults.
export function findMatchingIds(
  candidates: SearchCandidate[],
  query: string
): string[] {
  return scoredRowIdsNewestFirst(scoreSearchCandidates(candidates, query));
}

// Navigation ordering over rows the caller already scored, so a caller that
// scored once for the counter does not walk the corpus again.
//
// A separate function rather than an overload of `findMatchingIds`: both
// shapes are arrays, so a runtime union check cannot tell a scored row from a
// candidate and would silently score the wrong thing.
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
  // Clamped to a page that actually exists, so a shrinking result set can
  // never strand the pager past the end.
  page: number;
  pageCount: number;
  pageResults: RankedSearchResult[];
  // 1-based inclusive bounds of the current page, for the bar's "1–20 of 87".
  rangeEnd: number;
  rangeStart: number;
}

// Slices one page out of the ranked results.
//
// `totalCount` is the WHOLE result set, not `results.length`: the hook holds
// one page at a time, so pass the full intersection and the bounds describe a
// position in the conversation rather than in the loaded rows. `pageResults`
// is whatever the caller holds for this page, so an unread page yields an
// empty slice with honest bounds -- the bar shows the range while the list
// shows loading.
export function paginateSearchResults(
  results: RankedSearchResult[],
  requestedPage: number,
  pageSize = SEARCH_PAGE_SIZE,
  totalCount = results.length,
  totalCountExact = true
): SearchPage {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = Math.max(
    0,
    Math.trunc(Number.isFinite(totalCount) ? totalCount : 0)
  );
  const requested = Number.isFinite(requestedPage)
    ? Math.trunc(requestedPage)
    : 0;
  const normalizedRequested = Math.max(requested, 0);
  const pageCount = Math.max(
    1,
    Math.ceil(total / size),
    totalCountExact ? 0 : normalizedRequested + 1
  );
  const page = totalCountExact
    ? Math.min(normalizedRequested, pageCount - 1)
    : normalizedRequested;
  const start = page * size;
  const end = Math.min(start + size, total);
  // The rows for this page are the ones the caller holds when it is holding this
  // page's slice. When the total exceeds the loaded rows (paging), the loaded
  // rows ARE the current page, so the page-relative offset is what applies.
  const pageOffset = total > results.length ? 0 : start;
  const rows = results.slice(pageOffset, pageOffset + size);
  const rangeStart = total === 0 ? 0 : start + 1;
  // The upper bound is the last row the page actually HOLDS, not the last slot
  // its position allows: a sticky total that undercounts (kept while a fresh
  // index read is in flight) would otherwise print a range longer than the page.
  // An empty page keeps its nominal position -- the window is still on its way.
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

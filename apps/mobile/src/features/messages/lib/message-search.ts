// Pure, UI-free helpers for in-conversation message search. Client-side because
// the server stores only ciphertext. No React, no decryptor, so unit-testable.
import { orderedCopy } from "@/lib/ordered-copy";

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
  return orderedCopy(
    scored,
    (left, right) => right.candidate.createdAt - left.candidate.createdAt
  ).map((row) => row.candidate.id);
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

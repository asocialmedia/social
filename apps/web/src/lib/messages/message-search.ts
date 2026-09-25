// Pure, UI-free helpers for in-conversation message search.
//
// Why search is client-side: the server stores only AES-GCM ciphertext, so it
// can never match plaintext. The thread pages history through the messages
// endpoint, decrypts locally via the shared decryptor, and ranks here. These
// helpers stay pure (no React, no decryptor) so they are unit-testable and
// reusable by any future surface (e.g. a cross-conversation index).

import type { MessagePayload } from "./crypto";

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

export type SearchableMessageKind = "media" | "post" | "text";

// The human-visible text a payload contributes to the index: the typed body
// for text, the caption plus a kind label otherwise. The label keeps
// captionless rows findable ("gif" matches a captionless GIF) without ever
// inventing body text that is not there.
export function extractSearchableText(payload: MessagePayload): {
  kind: SearchableMessageKind;
  text: string;
} {
  if (payload.type === "text") {
    return { kind: "text", text: payload.content };
  }
  if (payload.type === "post") {
    const label = "Shared a post";
    const caption = payload.content?.trim() ?? "";
    return {
      kind: "post",
      text: caption.length > 0 ? `${caption} ${label}` : label,
    };
  }
  const images = "images" in payload ? payload.images.length : 1;
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

// Ranks candidates for one query: AND token match, score desc, then newest
// first, sliced to MAX_SEARCH_RESULTS. Snippet + ranges are computed only for
// survivors so a huge corpus never pays highlight costs for rows nobody sees.
export function rankSearchResults(
  candidates: SearchCandidate[],
  query: string
): RankedSearchResult[] {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
    return [];
  }
  const tokens = searchQueryTokens(normalizedQuery);
  const scored: {
    candidate: SearchCandidate;
    firstMatchStart: number;
    score: number;
  }[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeSearchText(candidate.text);
    const score = scoreSearchMatch(normalized, tokens, normalizedQuery);
    if (score === null) {
      continue;
    }
    const firstMatchStart = normalized.indexOf(tokens[0] ?? "");
    // Only the derived numbers are retained: the normalized text is dropped
    // immediately, so a large corpus does not pin a second copy of every
    // message body while it sorts.
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
  const normalizedQuery = normalizeSearchText(query.trim());
  if (normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
    return [];
  }
  const tokens = searchQueryTokens(normalizedQuery);
  const matches: SearchCandidate[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeSearchText(candidate.text);
    if (scoreSearchMatch(normalized, tokens, normalizedQuery) !== null) {
      matches.push(candidate);
    }
  }
  matches.sort((left, right) => right.createdAt - left.createdAt);
  return matches.map((candidate) => candidate.id);
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

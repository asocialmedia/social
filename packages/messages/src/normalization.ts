import {
  MESSAGE_SEARCH_MAXIMUM_QUERY_CODE_POINTS,
  MESSAGE_SEARCH_MINIMUM_QUERY_LENGTH,
  MESSAGE_SEARCH_TERM_CHUNK_OVERLAP,
  MESSAGE_SEARCH_TERM_CHUNK_SIZE,
} from "./search-contracts";

export function normalizeMessageSearchText(value: string): string {
  // Shared normalization keeps server documents and offline matches identical.
  return value.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase();
}

export function normalizeMessageSearchQuery(query: string): {
  normalizedQuery: string;
  tokens: string[];
  valid: boolean;
} {
  const normalizedQuery = normalizeMessageSearchText(query.trim());
  const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  const codePointLength = [...normalizedQuery].length;
  return {
    normalizedQuery,
    tokens,
    valid:
      codePointLength >= MESSAGE_SEARCH_MINIMUM_QUERY_LENGTH &&
      codePointLength <= MESSAGE_SEARCH_MAXIMUM_QUERY_CODE_POINTS,
  };
}

export function splitMessageSearchTerm(term: string): string[] {
  const points = [...normalizeMessageSearchText(term)];
  if (points.length <= MESSAGE_SEARCH_TERM_CHUNK_SIZE) {
    return [points.join("")];
  }

  const step =
    MESSAGE_SEARCH_TERM_CHUNK_SIZE - MESSAGE_SEARCH_TERM_CHUNK_OVERLAP;
  const chunks: string[] = [];
  for (let start = 0; start < points.length; start += step) {
    chunks.push(
      points.slice(start, start + MESSAGE_SEARCH_TERM_CHUNK_SIZE).join("")
    );
  }
  return chunks;
}

export function messageSearchTerms(value: string): string[] {
  const terms = new Set<string>();
  for (const term of normalizeMessageSearchText(value).split(/\s+/u)) {
    if (!term) {
      continue;
    }
    for (const chunk of splitMessageSearchTerm(term)) {
      if (chunk) {
        terms.add(chunk);
      }
    }
  }
  return [...terms];
}

export function messageSearchGramKeys(value: string): string[] {
  const points = [...normalizeMessageSearchText(value)];
  const keys = new Set<string>();
  for (let width = 1; width <= 3; width += 1) {
    for (let index = 0; index + width <= points.length; index += 1) {
      keys.add(`${width}:${points.slice(index, index + width).join("")}`);
    }
  }
  return [...keys];
}

export function messageSearchQueryGramKeys(token: string): string[] {
  const points = [...normalizeMessageSearchText(token)];
  const width = Math.min(3, points.length);
  const grams = new Set<string>();
  for (let index = 0; index + width <= points.length; index += 1) {
    grams.add(`${width}:${points.slice(index, index + width).join("")}`);
  }
  return [...grams];
}

export function messageSearchTermsMatch(
  terms: readonly string[],
  query: string
): boolean {
  const { tokens, valid } = normalizeMessageSearchQuery(query);
  if (!valid || tokens.length === 0) {
    return false;
  }
  return tokens.every((token) =>
    terms.some((term) => normalizeMessageSearchText(term).includes(token))
  );
}

export const MESSAGE_SEARCH_MINIMUM_QUERY_LENGTH = 2;
export const MESSAGE_SEARCH_MAXIMUM_QUERY_CODE_POINTS = 256;
export const MESSAGE_SEARCH_TERM_CHUNK_SIZE = 512;
export const MESSAGE_SEARCH_TERM_CHUNK_OVERLAP = 255;
export const MESSAGE_SEARCH_NORMALIZATION_VERSION = 1;

export interface MessageSearchFeatureFlagEnvironment {
  MESSAGE_SEARCH_BACKFILL_ENABLED?: string;
  MESSAGE_SEARCH_COUNT_ENABLED?: string;
  MESSAGE_SEARCH_SERVER_ENABLED?: string;
}

export interface MessageSearchFeatureFlags {
  backfill: boolean;
  counts: boolean;
  serverSearch: boolean;
}

function isMessageSearchFeatureEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no" ||
    normalized === "disabled"
  ) {
    return false;
  }
  return true;
}

export function readMessageSearchFeatureFlags(
  environment: MessageSearchFeatureFlagEnvironment
): MessageSearchFeatureFlags {
  return {
    backfill: isMessageSearchFeatureEnabled(
      environment.MESSAGE_SEARCH_BACKFILL_ENABLED
    ),
    counts: isMessageSearchFeatureEnabled(
      environment.MESSAGE_SEARCH_COUNT_ENABLED
    ),
    serverSearch: isMessageSearchFeatureEnabled(
      environment.MESSAGE_SEARCH_SERVER_ENABLED
    ),
  };
}

export interface MessageSearchablePayload {
  content?: string;
  images?: number | readonly unknown[];
  kind?: "gif" | "image";
  type: "media" | "post" | "text";
}

export function normalizeMessageSearchText(value: string): string {
  return value.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase();
}

export function searchableTextFromPayload(
  payload: MessageSearchablePayload
): string {
  const content = payload.content?.trim() ?? "";
  if (payload.type === "text") {
    return payload.content ?? "";
  }
  if (payload.type === "post") {
    return content.length > 0 ? `${content} Shared a post` : "Shared a post";
  }

  let imageCount = 1;
  if (Array.isArray(payload.images)) {
    imageCount = payload.images.length;
  } else if (typeof payload.images === "number") {
    imageCount = payload.images;
  }

  let label = "Shared an image";
  if (payload.kind === "gif") {
    label = "Shared a GIF";
  } else if (imageCount > 1) {
    label = `Shared ${imageCount} images`;
  }
  return content.length > 0 ? `${content} ${label}` : label;
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

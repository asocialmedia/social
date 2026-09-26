// The hashtag feed, a port of web's `components/posts/views/hashtag-feed.tsx`.
//
// Web reads `GET /api/search?q=<tag>` with a cursor, which is the same search
// endpoint the search screen uses, so the parsing is shared rather than
// duplicated: a tag page and a search for that tag are the same list.
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { normalizePostsData } from "@/features/feed/lib/feed-types";
import { getWithTimeout } from "@/lib/http-get";

export class HashtagApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HashtagApiError";
    this.status = status;
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Web's `safeDecodeTag` decodes and nothing else, then looks the tag up
 * case-insensitively and redirects to the stored casing. Native has no redirect
 * layer, so the lookup result cannot be reflected in the URL; lowercasing
 * instead matches what the tags API stores (`tags.map((t) => t.toLowerCase())`)
 * and therefore what a search for this tag resolves to.
 *
 * Decoding happens before the `#` is stripped so a link written as
 * `/hashtag/%23rust` resolves to `rust` rather than keeping a stray hash.
 */
export function canonicalTag(raw: string): string {
  let tag = raw.trim();
  try {
    tag = decodeURIComponent(tag);
  } catch {
    // A malformed escape is used as-is rather than throwing on a deep link.
  }
  tag = tag.trim();
  if (tag.startsWith("#")) {
    tag = tag.slice(1);
  }
  return tag.trim().toLowerCase();
}

export function buildHashtagPath(tag: string, cursor: string | null): string {
  const params = new URLSearchParams({ q: tag });
  if (cursor) {
    params.set("cursor", cursor);
  }
  return `/api/search?${params.toString()}`;
}

export function parseHashtagPage(payload: unknown): {
  nextCursor: string | null;
  posts: FeedPost[];
} {
  const body = objectOf(payload) ?? {};
  return {
    nextCursor: textOf(body.nextCursor),
    posts: normalizePostsData(
      Array.isArray(body.posts)
        ? body.posts.filter((post) => typeof objectOf(post)?.id === "string")
        : []
    ),
  };
}

export async function fetchHashtagPage(
  tag: string,
  cursor: string | null,
  options: ApiCallOptions
): Promise<{ nextCursor: string | null; posts: FeedPost[] }> {
  const response = await getWithTimeout(
    `${options.apiBase}${buildHashtagPath(tag, cursor)}`,
    { headers: options.cookie ? { cookie: options.cookie } : {} },
    { baseFetch: options.baseFetch ?? fetch, timeoutMs: options.timeoutMs }
  );
  if (!response.ok) {
    throw new HashtagApiError(
      `Hashtag feed request failed (${response.status})`,
      response.status
    );
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return parseHashtagPage(payload);
}

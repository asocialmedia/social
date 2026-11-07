// The hashtag feed, a port of web's `components/posts/views/hashtag-feed.tsx`.
//
// Web merges two sources: asocialmedia posts from
// `GET /api/hashtags/<tag>/posts?cursor=` and Bluesky posts from
// `GET /api/protocols/bluesky/hashtag?tag=&cursor=`. Everything here is pure
// so the request hook and the screen stay thin and the rules are testable.
import type { ExternalPost } from "@asm/protocols/contracts";
import { externalPostSchema, normalizeHashtag } from "@asm/protocols/discovery";
import type { FeedSource } from "@asm/protocols/discovery";
import { z } from "zod";

import { flattenFeedRows } from "@/features/feed/lib/feed-rows";
import {
  groupPostsIntoThreads,
  insertionOrder,
  normalizePostsData,
} from "@/features/feed/lib/feed-types";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { mixedFeedRows } from "@/features/feed/lib/mixed-feed-rows";
import type { TimelineRow } from "@/features/feed/lib/mixed-feed-rows";

export interface HashtagPage<Item> {
  cursor: string | null;
  items: Item[];
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Both hashtag routes run the tag through `normalizeHashtag` and answer 400
// when it fails, so the screen applies the same rule up front: a tag that does
// not normalise is a broken link, not a request worth sending. Web redirects a
// non-canonical casing to the stored one; native has no redirect layer, and the
// normalised form is what both routes query with anyway.
//
// Decoding happens before the `#` is stripped so a link written as
// `/hashtag/%23rust` resolves to `rust` rather than keeping a stray hash.
export function canonicalTag(raw: string): string {
  let tag = raw.trim();
  try {
    tag = decodeURIComponent(tag);
  } catch {
    // A malformed escape is used as-is rather than throwing on a deep link.
  }
  return normalizeHashtag(tag.trim()) ?? "";
}

export function hashtagPostsPath(tag: string, cursor: string | null): string {
  const path = `/api/hashtags/${encodeURIComponent(tag)}/posts`;
  return cursor ? `${path}?${new URLSearchParams({ cursor })}` : path;
}

export function blueskyHashtagPath(tag: string, cursor: string | null): string {
  const params = new URLSearchParams({ tag });
  if (cursor) {
    params.set("cursor", cursor);
  }
  return `/api/protocols/bluesky/hashtag?${params}`;
}

// The asocialmedia route answers `PostsPage` ({ posts, nextCursor }), the same
// shape `/api/search` returns, so parsing stays lenient the way the rest of the
// native feed parses posts: unusable rows are dropped, not fatal.
export function parseHashtagPage(payload: unknown): HashtagPage<FeedPost> {
  const body = objectOf(payload) ?? {};
  return {
    cursor: textOf(body.nextCursor),
    items: normalizePostsData(
      Array.isArray(body.posts)
        ? body.posts.filter((post) => typeof objectOf(post)?.id === "string")
        : []
    ),
  };
}

// Web's `externalPageSchema`: strict, so a malformed Bluesky page surfaces as a
// source error instead of rendering half-parsed posts.
const blueskyHashtagPageSchema = z.object({
  cursor: z.string().nullable(),
  items: z.array(externalPostSchema).max(50),
});

export function parseBlueskyHashtagPage(
  payload: unknown
): HashtagPage<ExternalPost> {
  return blueskyHashtagPageSchema.parse(payload);
}

// A later page can repeat an id from an earlier one (both routes page by
// keyset and the Bluesky side over a moving index); the first copy wins.
export function appendUnique<Item extends { id: string }>(
  current: readonly Item[],
  incoming: readonly Item[]
): Item[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      next.push(item);
    }
  }
  return next;
}

// Web's FeedView with `sortBy="newest"`: newest first, grouped into threads,
// then interleaved with Bluesky posts by `mixFeedItems` in latest mode. The
// native home feed's `mixedFeedRows` is the same call over virtualised rows.
export function hashtagTimelineRows(
  posts: readonly FeedPost[],
  external: ExternalPost[],
  source: FeedSource
): TimelineRow[] {
  // insertionOrder rather than toSorted: Hermes on the emulator lacks it.
  const newest = insertionOrder(
    posts,
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
  return mixedFeedRows(
    flattenFeedRows(groupPostsIntoThreads(newest)),
    external,
    source,
    true
  );
}

export type HashtagFeedView =
  | "content"
  | "empty"
  | "error"
  | "loading"
  | "network-error";

// The branch order of web's HashtagFeed render. "content" can still have no
// rows while a source pages past filtered-out windows; the screen keeps
// paging in that case the way web's `continuationDelay` does.
export function hashtagFeedView(input: {
  failed: boolean;
  hasContent: boolean;
  hasMore: boolean;
  networkError: boolean;
  networkReady: boolean;
  pending: boolean;
}): HashtagFeedView {
  if (!input.networkReady && input.networkError) {
    return "network-error";
  }
  if (!input.hasContent && input.pending) {
    return "loading";
  }
  if (!input.hasContent && input.failed) {
    return "error";
  }
  if (!input.hasContent && !input.hasMore) {
    return "empty";
  }
  return "content";
}

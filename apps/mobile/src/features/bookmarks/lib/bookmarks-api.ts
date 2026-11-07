import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { FeedPost, PostsPage } from "@/features/feed/lib/feed-types";
import { normalizePostsData } from "@/features/feed/lib/feed-types";
import { parseHnStories } from "@/features/hackernews/lib/hackernews-api";
import type { HnStory } from "@/features/hackernews/lib/hackernews-api";
import { withAuthHeaders } from "@/lib/network/auth-headers";
import { getWithTimeout } from "@/lib/network/http-get";

export type { HnStory } from "@/features/hackernews/lib/hackernews-api";

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parsePostsPage(payload: unknown): PostsPage {
  const row = objectOf(payload) ?? {};
  return {
    nextCursor: typeof row.nextCursor === "string" ? row.nextCursor : null,
    posts: Array.isArray(row.posts)
      ? normalizePostsData(
          row.posts.filter(
            (post) => objectOf(post)?.id !== undefined
          ) as FeedPost[]
        )
      : [],
  };
}

function get(path: string, options: ApiCallOptions): Promise<Response> {
  return getWithTimeout(
    `${options.apiBase}${path}`,
    { headers: withAuthHeaders({}, options.cookie) },
    { baseFetch: options.baseFetch ?? fetch, timeoutMs: options.timeoutMs }
  );
}

async function readJson(response: Response): Promise<unknown> {
  return (await response.json().catch(() => null)) as unknown;
}

export async function fetchBookmarkedPosts(
  filter: "gusts" | "posts",
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const page = await fetchBookmarkedPage(filter, options);
  return page.posts;
}

export async function fetchBookmarkedPage(
  filter: "gusts" | "posts",
  options: ApiCallOptions,
  cursor?: string
): Promise<PostsPage> {
  const query = new URLSearchParams();
  if (filter === "gusts") {
    query.set("filter", "gusts");
  }
  if (cursor) {
    query.set("cursor", cursor);
  }
  const params = query.toString();
  const response = await get(
    `/api/posts/bookmarked${params ? `?${params}` : ""}`,
    options
  );
  if (!response.ok) {
    throw new Error(`Bookmarks request failed (${response.status})`);
  }
  return parsePostsPage(await readJson(response));
}

export async function fetchLikedPosts(
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const page = await fetchLikedPage(options);
  return page.posts;
}

export async function fetchLikedPage(
  options: ApiCallOptions,
  cursor?: string
): Promise<PostsPage> {
  const response = await get(
    `/api/posts/liked${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    options
  );
  if (!response.ok) {
    throw new Error(`Likes request failed (${response.status})`);
  }
  return parsePostsPage(await readJson(response));
}

export async function fetchBookmarkedHn(
  options: ApiCallOptions
): Promise<HnStory[]> {
  const response = await get("/api/hackernews/bookmarked", options);
  if (!response.ok) {
    throw new Error(
      `Hacker News bookmarks request failed (${response.status})`
    );
  }
  return parseHnStories(await readJson(response));
}

export interface BookmarkCounts {
  gustCount: number;
  hnCount: number;
  postCount: number;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function parseBookmarkCounts(payload: unknown): BookmarkCounts {
  const row = objectOf(payload) ?? {};
  return {
    gustCount: countOf(row.gustCount),
    hnCount: countOf(row.hnCount),
    postCount: countOf(row.postCount),
  };
}

// Web's useBookmarkCount source: the per-tab totals behind the tab badges.
export async function fetchBookmarkCounts(
  options: ApiCallOptions
): Promise<BookmarkCounts> {
  const response = await get("/api/bookmarks/count", options);
  if (!response.ok) {
    throw new Error(`Bookmark count request failed (${response.status})`);
  }
  return parseBookmarkCounts(await readJson(response));
}

export type BookmarkTab = "gusts" | "hackernews" | "likes" | "posts";

// Web's per-tab empty and error copy (bookmarks.tsx, bookmarked-gusts.tsx,
// liked-posts.tsx). Posts and HackerNews show the illustration, gusts and
// likes a small glyph.
export const BOOKMARK_TAB_COPY: Record<
  BookmarkTab,
  { description: string; error: string; illustrated: boolean; title: string }
> = {
  gusts: {
    description: "Gusts you bookmark will show up here.",
    error: "An error occurred while loading bookmarked gusts.",
    illustrated: false,
    title: "No bookmarked gusts yet.",
  },
  hackernews: {
    description: "Bookmark HackerNews stories to read them later.",
    error: "An error occurred while loading HackerNews bookmarks.",
    illustrated: true,
    title: "No bookmarked HackerNews stories.",
  },
  likes: {
    description: "Posts you amplify will show up here.",
    error: "An error occurred while loading liked posts.",
    illustrated: false,
    title: "No liked posts yet.",
  },
  posts: {
    description: "Bookmark fleets to read them later.",
    error: "An error occurred while loading bookmarked fleets.",
    illustrated: true,
    title: "You don't have any bookmarks yet.",
  },
};

// The badge count web shows beside a tab label (Likes has none).
export function bookmarkTabCount(
  tab: BookmarkTab,
  counts: BookmarkCounts | null
): number {
  if (!counts) {
    return 0;
  }
  if (tab === "posts") {
    return counts.postCount;
  }
  if (tab === "gusts") {
    return counts.gustCount;
  }
  if (tab === "hackernews") {
    return counts.hnCount;
  }
  return 0;
}

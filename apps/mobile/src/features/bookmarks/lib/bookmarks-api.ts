import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { FeedPost, PostsPage } from "@/features/feed/lib/feed-types";
import { normalizePostsData } from "@/features/feed/lib/feed-types";
import { parseHnStories } from "@/features/hackernews/lib/hackernews-api";
import type { HnStory } from "@/features/hackernews/lib/hackernews-api";
import { withAuthHeaders } from "@/lib/auth-headers";
import { getWithTimeout } from "@/lib/http-get";

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

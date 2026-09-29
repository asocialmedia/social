import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { FeedPost, PostsPage } from "@/features/feed/lib/feed-types";
import { normalizePostsData } from "@/features/feed/lib/feed-types";
import { withAuthHeaders } from "@/lib/auth-headers";
import { getWithTimeout } from "@/lib/http-get";

export interface HnStory {
  by: string;
  descendants: number;
  id: number;
  score: number;
  time: string;
  title: string;
  url: string | null;
}

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

function parseHnStory(value: unknown): HnStory | null {
  const row = objectOf(value);
  if (!row || typeof row.id !== "number" || typeof row.title !== "string") {
    return null;
  }
  return {
    by: typeof row.by === "string" ? row.by : "unknown",
    descendants: typeof row.descendants === "number" ? row.descendants : 0,
    id: row.id,
    score: typeof row.score === "number" ? row.score : 0,
    time: typeof row.time === "string" ? row.time : new Date().toISOString(),
    title: row.title,
    url: typeof row.url === "string" ? row.url : null,
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
  const path =
    filter === "gusts"
      ? "/api/posts/bookmarked?filter=gusts"
      : "/api/posts/bookmarked";
  const response = await get(path, options);
  if (!response.ok) {
    throw new Error(`Bookmarks request failed (${response.status})`);
  }
  return parsePostsPage(await readJson(response)).posts;
}

export async function fetchLikedPosts(
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const response = await get("/api/posts/liked", options);
  if (!response.ok) {
    throw new Error(`Likes request failed (${response.status})`);
  }
  return parsePostsPage(await readJson(response)).posts;
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
  const row = objectOf(await readJson(response)) ?? {};
  return Array.isArray(row.stories)
    ? row.stories.flatMap((value) => {
        const story = parseHnStory(value);
        return story ? [story] : [];
      })
    : [];
}

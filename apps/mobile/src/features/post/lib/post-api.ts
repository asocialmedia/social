// Single-post data layer for the native detail + media screens.
// Ports web client-post's detail query (GET /api/posts/:id -> {post, ancestors})
// plus the related rail (GET /api/posts/:id/related) and the best-effort
// visit record (POST /api/posts/visit). Pure + injectable like feed-api.ts:
// cookie, apiBase and baseFetch come from the caller.
//
// Auth note: GET /api/posts/:id currently 401s for guests (web SSR reads via
// prisma directly, so guests can view there). Native shows the login gate on
// 401 until the backend permits guest reads; the related endpoint already
// allows guests.

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { FeedApiError } from "@/features/feed/lib/feed-api";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { normalizePostData } from "@/features/feed/lib/feed-types";

function callPostApi(
  path: string,
  options: ApiCallOptions & { body?: string; method?: string }
): Promise<Response> {
  const baseFetch = options.baseFetch ?? fetch;
  const headers: Record<string, string> = {};
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return baseFetch(`${options.apiBase}${path}`, {
    body: options.body,
    headers,
    method: options.method ?? "GET",
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export interface PostDetail {
  ancestors: FeedPost[];
  post: FeedPost;
}

function parsePostDetail(payload: unknown): PostDetail | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const data = payload as { ancestors?: unknown; post?: unknown };
  const post = data.post as FeedPost | undefined;
  if (!post || typeof post.id !== "string") {
    return null;
  }
  const ancestors = Array.isArray(data.ancestors)
    ? (data.ancestors as FeedPost[]).filter(
        (entry) => entry && typeof entry.id === "string"
      )
    : [];
  return {
    ancestors: ancestors.map(normalizePostData),
    post: normalizePostData(post),
  };
}

// Fetches one post + its ancestor chain. Throws FeedApiError with the real
// status so the screen can branch: 401 -> login gate, 404 -> not-found art.
export async function fetchPostDetail(
  postId: string,
  options: ApiCallOptions
): Promise<PostDetail> {
  const response = await callPostApi(
    `/api/posts/${encodeURIComponent(postId)}`,
    options
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Post request failed (${response.status})`,
      response.status
    );
  }
  const detail = parsePostDetail(await readJson(response));
  if (!detail) {
    throw new FeedApiError("Post response was not usable", response.status);
  }
  return detail;
}

// Related rail for "View more content": web's /api/posts/:id/related returns
// {posts}. Empty on failure (decorative rail, never a fatal error).
export async function fetchRelatedPosts(
  postId: string,
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const response = await callPostApi(
    `/api/posts/${encodeURIComponent(postId)}/related`,
    options
  );
  if (!response.ok) {
    return [];
  }
  const payload = (await readJson(response)) as { posts?: unknown } | null;
  if (!Array.isArray(payload?.posts)) {
    return [];
  }
  return (payload.posts as FeedPost[])
    .filter((post) => post && typeof post.id === "string")
    .map(normalizePostData)
    .filter((post) => post.id !== postId);
}

// Best-effort visit record so recents surface the post. Guests have no visit
// history, so callers skip this entirely when logged out. Failures are silent.
export async function recordPostVisit(
  postId: string,
  options: ApiCallOptions
): Promise<void> {
  try {
    await callPostApi("/api/posts/visit", {
      ...options,
      body: JSON.stringify({ postId }),
      method: "POST",
    });
  } catch {
    // Best-effort visit tracking; ignore failures like web client-post.
  }
}

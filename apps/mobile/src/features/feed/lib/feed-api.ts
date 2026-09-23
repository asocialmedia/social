// Feed API layer: cursor feeds, votes, bookmark, comments, responses, view
// batching and share stats. Every call rides the API base (getApiBaseUrl:
// dev server in dev, prod in release) with the stored session cookie
// (authClient.getCookie). Pure and injectable for testing: cookie, apiBase
// and baseFetch come from the caller, mirroring profile-data.ts.

import type { FeedPost, PostsPage } from "./feed-types";
import { mediaCaptionsPath, mediaWavePeaksPath } from "./media-url";
import { parseWavePeaks } from "./waveform";
import type { WavePeaks } from "./waveform";

export interface ApiCallOptions {
  apiBase: string;
  baseFetch?: typeof fetch;
  cookie?: string;
}

export class FeedApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FeedApiError";
    this.status = status;
  }
}

function callFeedApi(
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

export type FeedVariant = "following" | "latest" | "personalized" | "trending";

const FEED_ENDPOINTS: Record<FeedVariant, string> = {
  following: "/api/posts/following",
  latest: "/api/posts/latest",
  personalized: "/api/posts/for-you",
  trending: "/api/posts/trending",
};

function parsePostsPage(payload: unknown): PostsPage {
  const page = (payload ?? {}) as {
    nextCursor?: unknown;
    posts?: unknown;
  };
  return {
    nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
    posts: Array.isArray(page.posts)
      ? (page.posts as FeedPost[]).filter(
          (post) => post && typeof post.id === "string"
        )
      : [],
  };
}

/** One cursor page of a feed variant. */
export async function fetchFeedPage(
  variant: FeedVariant,
  cursor: string | null,
  options: ApiCallOptions
): Promise<PostsPage> {
  const endpoint = FEED_ENDPOINTS[variant];
  const path = cursor
    ? `${endpoint}?cursor=${encodeURIComponent(cursor)}`
    : endpoint;
  const response = await callFeedApi(path, options);
  if (!response.ok) {
    throw new FeedApiError(
      `Feed request failed (${response.status})`,
      response.status
    );
  }
  return parsePostsPage(await readJson(response));
}

/** Head page only, for the new-content probe (never touches list state). */
export async function fetchFeedHead(
  variant: FeedVariant,
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const page = await fetchFeedPage(variant, null, options);
  return page.posts;
}

export interface VoteInfo {
  aura: number;
  userVote: number;
}

function parseVoteInfo(payload: unknown): VoteInfo | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const data = payload as { aura?: unknown; userVote?: unknown };
  if (typeof data.aura !== "number" || typeof data.userVote !== "number") {
    return null;
  }
  return { aura: data.aura, userVote: data.userVote };
}

// Posts vote on /api/posts/:id/votes; eddies share the flow against
// /api/comments/:id/vote, exactly like web's AuraVoteButton with commentId.
function voteEndpoint(postId: string, commentId?: string): string {
  if (commentId) {
    return `/api/comments/${encodeURIComponent(commentId)}/vote`;
  }
  return `/api/posts/${encodeURIComponent(postId)}/votes`;
}

export async function fetchVoteInfo(
  postId: string,
  options: ApiCallOptions,
  commentId?: string
): Promise<VoteInfo | null> {
  const response = await callFeedApi(voteEndpoint(postId, commentId), options);
  if (!response.ok) {
    return null;
  }
  return parseVoteInfo(await readJson(response));
}

/** Casts (or via value 0, clears) a vote. Toggle-off uses DELETE like web. */
export async function submitVote(
  postId: string,
  value: 1 | -1 | 0,
  isToggleOff: boolean,
  options: ApiCallOptions,
  commentId?: string
): Promise<VoteInfo> {
  const response = await callFeedApi(voteEndpoint(postId, commentId), {
    ...options,
    body: isToggleOff ? undefined : JSON.stringify({ value }),
    method: isToggleOff ? "DELETE" : "POST",
  });
  if (!response.ok) {
    throw new FeedApiError(
      `Vote request failed (${response.status})`,
      response.status
    );
  }
  const info = parseVoteInfo(await readJson(response));
  if (!info) {
    throw new FeedApiError("Vote response was not usable", response.status);
  }
  return info;
}

export async function fetchBookmarkInfo(
  postId: string,
  options: ApiCallOptions
): Promise<boolean | null> {
  const response = await callFeedApi(
    `/api/posts/${encodeURIComponent(postId)}/bookmark`,
    options
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await readJson(response)) as {
    isBookmarkedByUser?: unknown;
  } | null;
  return typeof payload?.isBookmarkedByUser === "boolean"
    ? payload.isBookmarkedByUser
    : null;
}

/** Saves (true) or removes (false) a bookmark. Idempotent server-side. */
export async function submitBookmark(
  postId: string,
  save: boolean,
  options: ApiCallOptions
): Promise<void> {
  const response = await callFeedApi(
    `/api/posts/${encodeURIComponent(postId)}/bookmark`,
    { ...options, method: save ? "POST" : "DELETE" }
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Bookmark request failed (${response.status})`,
      response.status
    );
  }
}

export interface FeedComment {
  _count?: { votes?: number };
  attachments?: {
    id: string;
    mimeType?: string | null;
    type?: string | null;
  }[];
  aura?: number | null;
  content?: string | null;
  createdAt: string;
  deleted?: boolean | null;
  id: string;
  parentId?: string | null;
  postId?: string;
  replies?: FeedComment[];
  user?: {
    avatarUrl: string | null;
    badge?: string | null;
    badges?: string[] | null;
    communityMemberships?: { role: string }[] | null;
    displayName?: string | null;
    id: string;
    username?: string | null;
  } | null;
  votes?: { userId: string; value: number }[];
}

export interface CommentsPage {
  comments: FeedComment[];
  previousCursor: string | null;
}

function parseCommentsPage(payload: unknown): CommentsPage {
  const page = (payload ?? {}) as {
    comments?: unknown;
    previousCursor?: unknown;
  };
  return {
    comments: Array.isArray(page.comments)
      ? (page.comments as FeedComment[]).filter(
          (comment) => comment && typeof comment.id === "string"
        )
      : [],
    previousCursor:
      typeof page.previousCursor === "string" ? page.previousCursor : null,
  };
}

export async function fetchCommentsPage(
  postId: string,
  cursor: string | null,
  options: ApiCallOptions
): Promise<CommentsPage> {
  const base = `/api/posts/${encodeURIComponent(postId)}/comments`;
  const path = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
  const response = await callFeedApi(path, options);
  if (!response.ok) {
    throw new FeedApiError(
      `Comments request failed (${response.status})`,
      response.status
    );
  }
  return parseCommentsPage(await readJson(response));
}

export async function createComment(
  postId: string,
  content: string,
  options: ApiCallOptions,
  parentId?: string
): Promise<void> {
  const response = await callFeedApi(
    `/api/posts/${encodeURIComponent(postId)}/comments`,
    {
      ...options,
      body: JSON.stringify(parentId ? { content, parentId } : { content }),
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Comment request failed (${response.status})`,
      response.status
    );
  }
}

export interface ResponsesPage {
  previousCursor: string | null;
  responses: FeedPost[];
}

export async function fetchResponsesPage(
  postId: string,
  cursor: string | null,
  options: ApiCallOptions
): Promise<ResponsesPage> {
  const base = `/api/posts/${encodeURIComponent(postId)}/responses`;
  const path = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
  const response = await callFeedApi(path, options);
  if (!response.ok) {
    throw new FeedApiError(
      `Responses request failed (${response.status})`,
      response.status
    );
  }
  // The route answers { responses, previousCursor } (not the feed's
  // { posts, nextCursor }); parsing it as a feed page left every response
  // list empty.
  const page = ((await readJson(response)) ?? {}) as {
    previousCursor?: unknown;
    responses?: unknown;
  };
  return {
    previousCursor:
      typeof page.previousCursor === "string" ? page.previousCursor : null,
    responses: Array.isArray(page.responses)
      ? (page.responses as FeedPost[]).filter(
          (post) => post && typeof post.id === "string"
        )
      : [],
  };
}

/** Batched view increments (800ms debounce lives in the caller, like web). */
export async function submitViewBatch(
  postIds: string[],
  options: ApiCallOptions
): Promise<Record<string, number>> {
  if (postIds.length === 0) {
    return {};
  }
  const response = await callFeedApi("/api/views/batch", {
    ...options,
    body: JSON.stringify({ postIds }),
    method: "POST",
  });
  if (!response.ok) {
    throw new FeedApiError(
      `View batch failed (${response.status})`,
      response.status
    );
  }
  const payload = (await readJson(response)) as {
    results?: unknown;
  } | null;
  const results = payload?.results;
  if (typeof results !== "object" || results === null) {
    return {};
  }
  const counts: Record<string, number> = {};
  for (const [id, count] of Object.entries(
    results as Record<string, unknown>
  )) {
    if (typeof count === "number") {
      counts[id] = count;
    }
  }
  return counts;
}

export interface ShareStats {
  clicks: number;
  platform: string;
  shares: number;
}

export async function fetchShareStats(
  postId: string,
  options: ApiCallOptions
): Promise<ShareStats[]> {
  const response = await callFeedApi(
    `/api/posts/${encodeURIComponent(postId)}/share/stats`,
    options
  );
  if (!response.ok) {
    return [];
  }
  const payload = (await readJson(response)) as unknown;
  const list = Array.isArray(payload) ? payload : [];
  return list
    .filter(
      (entry): entry is ShareStats =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ShareStats).platform === "string"
    )
    .map((entry) => ({
      clicks: typeof entry.clicks === "number" ? entry.clicks : 0,
      platform: entry.platform,
      shares: typeof entry.shares === "number" ? entry.shares : 0,
    }));
}

export async function submitShare(
  postId: string,
  platform: string,
  options: ApiCallOptions
): Promise<void> {
  const response = await callFeedApi(
    `/api/posts/${encodeURIComponent(postId)}/share`,
    { ...options, body: JSON.stringify({ platform }), method: "POST" }
  );
  if (!response.ok) {
    throw new FeedApiError(
      `Share failed (${response.status})`,
      response.status
    );
  }
}

/** The audio row's waveform; null when the derivative is missing or bad. */
export async function fetchWavePeaks(
  mediaId: string,
  options: ApiCallOptions
): Promise<WavePeaks | null> {
  const response = await callFeedApi(mediaWavePeaksPath(mediaId), options);
  if (!response.ok) {
    return null;
  }
  return parseWavePeaks(await readJson(response));
}

/** A video's WebVTT captions; null when there is no track. */
export async function fetchCaptionsVtt(
  mediaId: string,
  options: ApiCallOptions
): Promise<string | null> {
  const response = await callFeedApi(mediaCaptionsPath(mediaId), options);
  if (!response.ok) {
    return null;
  }
  const text = await response.text();
  return text || null;
}

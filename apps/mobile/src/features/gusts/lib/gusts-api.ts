// Gusts API layer, ported from web's client-gusts query and the routes it
// rides: GET /api/gusts (personalized / chronological / deep-link pages),
// POST /api/posts/visit (history), POST/DELETE /api/users/:id/followers,
// and POST/DELETE /api/recommendations/not-interested (the REST twin of
// web's hide/unhide server actions). Pure and injectable like feed-api:
// cookie, apiBase and baseFetch come from the caller, so it unit-tests on
// Bun without React Native.
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { FeedApiError } from "@/features/feed/lib/feed-api";
import type { FeedPost, PostsPage } from "@/features/feed/lib/feed-types";
import { normalizePostsData } from "@/features/feed/lib/feed-types";

export type GustTab = "latest" | "personalized";

// Web's default: For you when signed in, Latest for guests.
export function defaultGustTab(isLoggedIn: boolean): GustTab {
  return isLoggedIn ? "personalized" : "latest";
}

export function parseGustTab(value: unknown = null): GustTab | null {
  return value === "latest" || value === "personalized" ? value : null;
}

export interface GustsQuery {
  cursor?: string | null;
  // Deep link: the first page leads with this gust, chronological after.
  initialId?: string | null;
  // A deep link is always chronological, exactly like web's isPersonalized.
  personalized: boolean;
  take?: number;
}

// The reel always opts out of moderated gusts (web sends excludeModerated=1).
export function buildGustsPath(query: GustsQuery): string {
  const params: string[] = [];
  if (query.cursor) {
    params.push(`cursor=${encodeURIComponent(query.cursor)}`);
  } else if (query.initialId) {
    params.push(`initialId=${encodeURIComponent(query.initialId)}`);
  }
  if (query.personalized && !query.initialId) {
    params.push("mode=personalized");
  }
  params.push("excludeModerated=1");
  if (query.take && query.take > 0) {
    params.push(`take=${Math.min(Math.trunc(query.take), 20)}`);
  }
  return `/api/gusts?${params.join("&")}`;
}

function request(
  path: string,
  options: ApiCallOptions & { body?: unknown; method?: string }
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
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

function ensureOk(response: Response, what: string): void {
  if (!response.ok) {
    throw new FeedApiError(
      `${what} failed (${response.status})`,
      response.status
    );
  }
}

export async function fetchGustsPage(
  query: GustsQuery,
  options: ApiCallOptions
): Promise<PostsPage> {
  const response = await request(buildGustsPath(query), options);
  ensureOk(response, "Gusts request");
  const page = ((await readJson(response)) ?? {}) as {
    nextCursor?: unknown;
    posts?: unknown;
  };
  return {
    nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
    posts: Array.isArray(page.posts)
      ? normalizePostsData(
          (page.posts as FeedPost[]).filter(
            (post) => post && typeof post.id === "string"
          )
        )
      : [],
  };
}

// A reel item needs a playable video and must not be moderated or hidden
// (web's client-side filter over the pages).
export function isPlayableGust(post: FeedPost): boolean {
  if (post.moderated) {
    return false;
  }
  return (post.attachments ?? []).some((media) => media?.type === "VIDEO");
}

export function gustVideo(post: FeedPost) {
  return (post.attachments ?? []).find((media) => media?.type === "VIDEO");
}

// Flattens pages into the reel. Dedupes by id, which web misses: the
// deep-link branch never excludes the lead gust from later cursor pages, so
// an older deep-linked gust would otherwise play twice.
export function mergeGustPages(
  pages: readonly PostsPage[],
  hiddenIds: ReadonlySet<string> = new Set()
): FeedPost[] {
  const seen = new Set<string>();
  const merged: FeedPost[] = [];
  for (const page of pages) {
    for (const post of page.posts) {
      if (seen.has(post.id) || hiddenIds.has(post.id)) {
        continue;
      }
      seen.add(post.id);
      if (isPlayableGust(post)) {
        merged.push(post);
      }
    }
  }
  return merged;
}

// History row for the signed-in viewer (web posts on every active change).
export async function markPostVisited(
  postId: string,
  options: ApiCallOptions
): Promise<void> {
  const response = await request("/api/posts/visit", {
    ...options,
    body: { postId },
    method: "POST",
  });
  ensureOk(response, "Visit");
}

export interface FollowerInfo {
  followers: number;
  isFollowedByUser: boolean;
}

export async function setFollowing(
  userId: string,
  follow: boolean,
  options: ApiCallOptions
): Promise<FollowerInfo> {
  const response = await request(
    `/api/users/${encodeURIComponent(userId)}/followers`,
    { ...options, method: follow ? "POST" : "DELETE" }
  );
  ensureOk(response, "Follow");
  const payload = ((await readJson(response)) ?? {}) as {
    followers?: unknown;
    isFollowedByUser?: unknown;
  };
  return {
    followers: typeof payload.followers === "number" ? payload.followers : 0,
    isFollowedByUser:
      typeof payload.isFollowedByUser === "boolean"
        ? payload.isFollowedByUser
        : follow,
  };
}

// Durable "Not interested": the personalized pool excludes the post across
// reloads, and undo (hidden=false) makes it eligible again.
export async function setNotInterested(
  postId: string,
  hidden: boolean,
  options: ApiCallOptions
): Promise<void> {
  const response = await request("/api/recommendations/not-interested", {
    ...options,
    body: { postId },
    method: hidden ? "POST" : "DELETE",
  });
  ensureOk(response, "Not interested");
}

export type RecommendationEventType =
  | "DWELL"
  | "IMPRESSION"
  | "VIEW_COMPLETE"
  | "VIEW_START";

export interface RecommendationEvent {
  durationMs?: number;
  eventType: RecommendationEventType;
  postId: string;
}

export async function submitRecommendationEvents(
  events: readonly RecommendationEvent[],
  options: ApiCallOptions
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const response = await request("/api/recommendations/events", {
    ...options,
    body: { events },
    method: "POST",
  });
  ensureOk(response, "Recommendation events");
}

// The shareable gust URL: web's getPostPath sends gusts to /gusts?id=<full>.
export function gustShareUrl(origin: string, postId: string): string {
  return `${origin.replace(/\/+$/, "")}/gusts?id=${encodeURIComponent(postId)}`;
}

// Web streams the published original on the gusts page (Range support), not
// the HLS ladder or the mp4 derivative the feed tiles use.
export function gustVideoUrl(apiBase: string, mediaId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/api/media/${mediaId}`;
}

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { FeedPost, FeedUser } from "@/features/feed/lib/feed-types";
import {
  normalizePostData,
  normalizePostsData,
} from "@/features/feed/lib/feed-types";
import type { ExploreTab } from "@/features/feed/state/tab-store";
import { getWithTimeout } from "@/lib/http-get";

export class ExploreApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ExploreApiError";
    this.status = status;
  }
}

export interface ExploreCommunityResult {
  accentColor: string | null;
  avatarUrl: string | null;
  id: string;
  name: string;
  slug: string;
}

export interface ExploreUser extends FeedUser {
  _count: { followers: number; following: number; posts: number };
  aura?: number;
  bannerUrl?: string | null;
  bio?: string | null;
  isFollowing: boolean;
  reason?: string;
  reasons?: string[];
  username: string;
}

export interface ExplorePage {
  communities: ExploreCommunityResult[];
  nextCursor: string | null;
  posts: FeedPost[];
  users: ExploreUser[];
}

export interface ExploreFollowResult {
  followers: number;
  isFollowedByUser: boolean;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cursorOf(value: unknown): string | null {
  return textOf(value);
}

function parsePost(value: unknown): FeedPost | null {
  const post = objectOf(value);
  return post && typeof post.id === "string"
    ? normalizePostData(post as unknown as FeedPost)
    : null;
}

function parseUser(value: unknown): ExploreUser | null {
  const user = objectOf(value);
  if (
    !user ||
    typeof user.id !== "string" ||
    typeof user.username !== "string"
  ) {
    return null;
  }
  const count = objectOf(user._count) ?? {};
  const followers = Array.isArray(user.followers) ? user.followers : [];
  const { id } = user;
  const { username } = user;
  if (typeof id !== "string" || typeof username !== "string") {
    return null;
  }
  return {
    ...(user as unknown as FeedUser),
    _count: {
      followers: countOf(count.followers),
      following: countOf(count.following),
      posts: countOf(count.posts),
    },
    isFollowing:
      typeof user.isFollowing === "boolean"
        ? user.isFollowing
        : followers.some((entry) => objectOf(entry)?.followerId === id),
    username,
  };
}

function parseCommunity(value: unknown): ExploreCommunityResult | null {
  const community = objectOf(value);
  if (
    !community ||
    typeof community.id !== "string" ||
    typeof community.name !== "string" ||
    typeof community.slug !== "string"
  ) {
    return null;
  }
  return {
    accentColor: textOf(community.accentColor),
    avatarUrl: textOf(community.avatarUrl),
    id: community.id,
    name: community.name,
    slug: community.slug,
  };
}

export function buildExploreSearchPath(query: string, tab: ExploreTab): string {
  return `/api/explore/search?q=${encodeURIComponent(query)}&tab=${encodeURIComponent(
    tab
  )}&take=20`;
}

export function buildExplorePostsPath(
  tab: "for-you" | "trending",
  cursor: string | null
): string {
  const path = `/api/posts/${tab}?excludeModerated=1&take=20`;
  return cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path;
}

export function buildExploreGustsPath(cursor: string | null): string {
  const path = "/api/gusts?excludeModerated=1&take=20";
  return cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path;
}

function get(path: string, options: ApiCallOptions): Promise<Response> {
  return getWithTimeout(
    `${options.apiBase}${path}`,
    { headers: options.cookie ? { cookie: options.cookie } : {} },
    { baseFetch: options.baseFetch ?? fetch, timeoutMs: options.timeoutMs }
  );
}

async function readJson(response: Response): Promise<unknown> {
  return (await response.json().catch(() => null)) as unknown;
}

function requireOk(response: Response, label: string): void {
  if (!response.ok) {
    throw new ExploreApiError(
      `${label} request failed (${response.status})`,
      response.status
    );
  }
}

export function parseExplorePage(
  payload: unknown,
  kind: "gusts" | "posts" | "search"
): ExplorePage {
  const body = objectOf(payload) ?? {};
  const rawPosts = Array.isArray(body.posts) ? body.posts : [];
  const rawUsers = Array.isArray(body.users) ? body.users : [];
  const rawCommunities = Array.isArray(body.communities)
    ? body.communities
    : [];
  return {
    communities: rawCommunities.flatMap((entry) => {
      const community = parseCommunity(entry);
      return community ? [community] : [];
    }),
    nextCursor: cursorOf(body.nextCursor),
    posts:
      kind === "gusts"
        ? rawPosts.flatMap((entry) => {
            const post = parsePost(entry);
            return post ? [post] : [];
          })
        : normalizePostsData(
            rawPosts.flatMap((entry) => {
              const post = parsePost(entry);
              return post ? [post] : [];
            })
          ),
    users: rawUsers.flatMap((entry) => {
      const user = parseUser(entry);
      return user ? [user] : [];
    }),
  };
}

export async function fetchExplorePage(
  tab: ExploreTab,
  query: string,
  cursor: string | null,
  options: ApiCallOptions
): Promise<ExplorePage> {
  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const response = await get(
      buildExploreSearchPath(trimmedQuery, tab),
      options
    );
    requireOk(response, "Explore search");
    return parseExplorePage(await readJson(response), "search");
  }

  if (tab === "gusts") {
    const response = await get(buildExploreGustsPath(cursor), options);
    requireOk(response, "Explore Gusts");
    return parseExplorePage(await readJson(response), "gusts");
  }

  if (tab === "people") {
    const response = await get("/api/users/trending", options);
    requireOk(response, "Explore people");
    return parseExplorePage(await readJson(response), "posts");
  }

  const [postsResponse, usersResponse] = await Promise.all([
    get(buildExplorePostsPath(tab, cursor), options),
    get(`/api/users/${tab === "for-you" ? "suggested" : "trending"}`, options),
  ]);
  requireOk(postsResponse, "Explore posts");
  requireOk(usersResponse, "Explore people");
  const [postsPayload, usersPayload] = await Promise.all([
    readJson(postsResponse),
    readJson(usersResponse),
  ]);
  const postsPage = parseExplorePage(postsPayload, "posts");
  const usersPage = parseExplorePage(
    Array.isArray(usersPayload) ? { users: usersPayload } : usersPayload,
    "posts"
  );
  return { ...postsPage, users: usersPage.users };
}

export async function fetchExplorePeople(
  query: string,
  viewerLoggedIn: boolean,
  options: ApiCallOptions
): Promise<ExplorePage> {
  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const response = await get(
      buildExploreSearchPath(trimmedQuery, "people"),
      options
    );
    requireOk(response, "Explore people search");
    return parseExplorePage(await readJson(response), "search");
  }
  const path = viewerLoggedIn
    ? "/api/users/suggested?limit=12"
    : "/api/users/trending";
  const response = await get(path, options);
  requireOk(response, "Explore people");
  const payload = await readJson(response);
  return parseExplorePage(
    Array.isArray(payload) ? { users: payload } : payload,
    "posts"
  );
}

export async function fetchExploreTopGusts(
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const response = await get("/api/gusts?excludeModerated=1&take=8", options);
  requireOk(response, "Explore Gusts");
  return parseExplorePage(await readJson(response), "gusts").posts;
}

export async function mutateExploreFollow(
  userId: string,
  next: boolean,
  options: ApiCallOptions
): Promise<ExploreFollowResult> {
  const response = await (options.baseFetch ?? fetch)(
    `${options.apiBase}/api/users/${encodeURIComponent(userId)}/followers`,
    {
      body: JSON.stringify({}),
      headers: {
        "Content-Type": "application/json",
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      method: next ? "POST" : "DELETE",
    }
  );
  const payload = await readJson(response);
  requireOk(response, "Follow request");
  const body = objectOf(payload) ?? {};
  return {
    followers: countOf(body.followers),
    isFollowedByUser:
      typeof body.isFollowedByUser === "boolean" ? body.isFollowedByUser : next,
  };
}

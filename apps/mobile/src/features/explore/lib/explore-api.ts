import type { ExternalAuthor } from "@asm/protocols/contracts";
import type { RecommendedAccount } from "@asm/protocols/discovery";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { FeedPost, FeedUser } from "@/features/feed/lib/feed-types";
import {
  normalizePostData,
  normalizePostsData,
} from "@/features/feed/lib/feed-types";
import type { ExploreTab } from "@/features/feed/state/tab-store";
import { appendNetworkQuery } from "@/features/network/lib/network-query";
import { withAuthHeaders } from "@/lib/network/auth-headers";
import { getWithTimeout } from "@/lib/network/http-get";

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
  // Web's UserReasonLine mutual-follower avatars (first three shown).
  mutualFollowers?: ExploreMutualFollower[];
  reason?: string;
  reasons?: string[];
  username: string;
}

export interface ExploreMutualFollower {
  avatarUrl: string | null;
  displayName: string;
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
    mutualFollowers: parseMutualFollowers(user.mutualFollowers),
    username,
  };
}

function parseMutualFollowers(value: unknown): ExploreMutualFollower[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const follower = objectOf(entry);
    const username = textOf(follower?.username);
    if (!follower || !username) {
      return [];
    }
    return [
      {
        avatarUrl: textOf(follower.avatarUrl),
        displayName: textOf(follower.displayName) ?? username,
        username,
      },
    ];
  });
}

// Web's UserReasonLine icon: with no mutual followers to show, the reason
// text picks a glyph by keyword.
export function reasonIcon(
  reason: string
): "active" | "popular" | "interest" | null {
  if (reason.includes("Active")) {
    return "active";
  }
  if (reason.includes("Popular")) {
    return "popular";
  }
  return reason.includes("interest") ? "interest" : null;
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

export function buildExploreSearchPath(
  query: string,
  tab: ExploreTab,
  take = 20
): string {
  return `/api/explore/search?q=${encodeURIComponent(query)}&tab=${encodeURIComponent(
    tab
  )}&take=${encodeURIComponent(String(take))}`;
}

export function buildExplorePostsPath(
  tab: "for-you" | "trending",
  cursor: string | null
): string {
  const path = `/api/posts/${tab}?excludeModerated=1&take=20`;
  return cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path;
}

// Web's ExploreGustsGrid: the personalized gust mix, twelve a page. The
// network context adds network, profile and surface=explore.
export function buildExploreGustsPath(cursor: string | null): string {
  const path = "/api/gusts?excludeModerated=1&mode=personalized&take=12";
  return cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path;
}

function get(path: string, options: ApiCallOptions): Promise<Response> {
  return getWithTimeout(
    `${options.apiBase}${appendNetworkQuery(path, options.network)}`,
    { headers: withAuthHeaders({}, options.cookie) },
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
    return {
      ...parseExplorePage(await readJson(response), "search"),
      nextCursor: null,
    };
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

  // Web's For you and Trending pages carry posts only (users: []): people
  // appear through the recommended-account cards woven into the stream, so
  // the extra /api/users request is not made.
  const response = await get(buildExplorePostsPath(tab, cursor), options);
  requireOk(response, "Explore posts");
  return { ...parseExplorePage(await readJson(response), "posts"), users: [] };
}

// Head-only probe for explore posts feeds ("for-you" and "trending").
// Fetches only the head page of posts without touching the user recommendation
// endpoints, matching web's lightweight explore poller.
export async function fetchExploreHeadPosts(
  tab: "for-you" | "trending",
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const response = await get(buildExplorePostsPath(tab, null), options);
  requireOk(response, "Explore posts probe");
  const payload = await readJson(response);
  const page = parseExplorePage(payload, "posts");
  return page.posts;
}

// Web's ExplorePeople search maps every Bluesky author to a
// RecommendedAccount ("Search match") rendered through the same network
// account card as the discovery suggestions, so a search match opens the
// Bluesky profile and follows in asocialmedia like any other suggestion.
export function blueskyAuthorToPeopleAccount(
  author: ExternalAuthor
): RecommendedAccount {
  return {
    avatarUrl: author.avatarUrl ?? null,
    bannerUrl: author.bannerUrl ?? null,
    displayName: author.displayName || author.handle,
    followers: author.upstreamCounts.followers ?? 0,
    following: false,
    handle: author.handle,
    href: `/network/bluesky/profile?actor=${encodeURIComponent(author.id)}`,
    id: author.id,
    reason: "Search match",
    source: "bluesky",
  };
}

// Web's People tab never touches the users endpoints: discovery renders the
// /api/recommendations/suggestions accounts (covered by
// useDiscoverySuggestions), and only a typed query fetches here, with
// take=12 like web's PEOPLE search.
export async function fetchExplorePeople(
  query: string,
  options: ApiCallOptions
): Promise<ExplorePage> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { communities: [], nextCursor: null, posts: [], users: [] };
  }
  const response = await get(
    buildExploreSearchPath(trimmedQuery, "people", 12),
    options
  );
  requireOk(response, "Explore people search");
  return parseExplorePage(await readJson(response), "search");
}

// Web explore-client's trending rail: mode=trending, network=1 and take=24,
// plus the active profile. The network context replaces network=1 with the
// viewer's scope (the route only checks that the key is present) and adds
// profile and locale. Web sends no surface for this rail, so it is dropped.
export function buildExploreTopGustsPath(): string {
  return "/api/gusts?excludeModerated=1&mode=trending&network=1&take=24";
}

export async function fetchExploreTopGusts(
  options: ApiCallOptions
): Promise<FeedPost[]> {
  const response = await get(buildExploreTopGustsPath(), {
    ...options,
    network: options.network
      ? { ...options.network, surface: undefined }
      : undefined,
  });
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
      headers: withAuthHeaders(
        { "Content-Type": "application/json" },
        options.cookie
      ),
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

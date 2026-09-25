import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { getWithTimeout } from "@/lib/http-get";

export interface SearchUserResult {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  bio: string | null;
  displayName: string;
  id: string;
  username: string;
}

export interface SearchPostResult {
  aura: number;
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  authorUsername: string;
  content: string;
  createdAt: string;
  explicitContent: boolean;
  id: string;
  isGust: boolean;
  previewMedia: {
    id: string;
    thumbnailKey: string | null;
    type: string;
  } | null;
  viewCount: number;
}

export interface SearchCommunityResult {
  accentColor: string;
  avatarUrl: string | null;
  id: string;
  memberCount: number;
  name: string;
  slug: string;
}

export interface SpotlightResponse {
  communities: SearchCommunityResult[];
  posts: SearchPostResult[];
  users: SearchUserResult[];
}

export interface SearchSuggestion {
  count: number;
  query: string;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseUser(value: unknown): SearchUserResult | null {
  const row = objectOf(value);
  if (!row || typeof row.id !== "string" || typeof row.username !== "string") {
    return null;
  }
  return {
    aura: numberOf(row.aura),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null,
    badge: typeof row.badge === "string" ? row.badge : null,
    badges: Array.isArray(row.badges)
      ? row.badges.filter((badge): badge is string => typeof badge === "string")
      : [],
    bio: typeof row.bio === "string" ? row.bio : null,
    displayName: textOf(row.displayName, row.username),
    id: row.id,
    username: row.username,
  };
}

function parsePost(value: unknown): SearchPostResult | null {
  const row = objectOf(value);
  if (!row || typeof row.id !== "string" || typeof row.content !== "string") {
    return null;
  }
  const preview = objectOf(row.previewMedia);
  return {
    aura: numberOf(row.aura),
    authorAvatarUrl:
      typeof row.authorAvatarUrl === "string" ? row.authorAvatarUrl : null,
    authorDisplayName: textOf(row.authorDisplayName, "Unknown author"),
    authorUsername: textOf(row.authorUsername, "unknown"),
    content: row.content,
    createdAt: textOf(row.createdAt, new Date().toISOString()),
    explicitContent: row.explicitContent === true,
    id: row.id,
    isGust: row.isGust === true,
    previewMedia:
      preview && typeof preview.id === "string"
        ? {
            id: preview.id,
            thumbnailKey:
              typeof preview.thumbnailKey === "string"
                ? preview.thumbnailKey
                : null,
            type: textOf(preview.type, "IMAGE"),
          }
        : null,
    viewCount: numberOf(row.viewCount),
  };
}

function parseCommunity(value: unknown): SearchCommunityResult | null {
  const row = objectOf(value);
  if (!row || typeof row.id !== "string" || typeof row.slug !== "string") {
    return null;
  }
  return {
    accentColor: textOf(row.accentColor, "#ff9500"),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null,
    id: row.id,
    memberCount: numberOf(row.memberCount),
    name: textOf(row.name, row.slug),
    slug: row.slug,
  };
}

export function buildSpotlightPath(query: string): string {
  return `/api/search/spotlight?limit=6&q=${encodeURIComponent(query.trim())}`;
}

export function buildSuggestionsPath(query: string): string {
  return `/api/search?type=suggestions&q=${encodeURIComponent(query.trim())}`;
}

export function parseSpotlightResponse(payload: unknown): SpotlightResponse {
  const row = objectOf(payload) ?? {};
  return {
    communities: Array.isArray(row.communities)
      ? row.communities.flatMap((value) => {
          const result = parseCommunity(value);
          return result ? [result] : [];
        })
      : [],
    posts: Array.isArray(row.posts)
      ? row.posts.flatMap((value) => {
          const result = parsePost(value);
          return result ? [result] : [];
        })
      : [],
    users: Array.isArray(row.users)
      ? row.users.flatMap((value) => {
          const result = parseUser(value);
          return result ? [result] : [];
        })
      : [],
  };
}

async function readJson(response: Response): Promise<unknown> {
  return (await response.json().catch(() => null)) as unknown;
}

function get(path: string, options: ApiCallOptions): Promise<Response> {
  return getWithTimeout(
    `${options.apiBase}${path}`,
    { headers: options.cookie ? { cookie: options.cookie } : {} },
    { baseFetch: options.baseFetch ?? fetch, timeoutMs: options.timeoutMs }
  );
}

export async function fetchSpotlight(
  query: string,
  options: ApiCallOptions
): Promise<SpotlightResponse> {
  const response = await get(buildSpotlightPath(query), options);
  if (!response.ok) {
    throw new Error(`Search request failed (${response.status})`);
  }
  return parseSpotlightResponse(await readJson(response));
}

export async function fetchSearchSuggestions(
  query: string,
  options: ApiCallOptions
): Promise<SearchSuggestion[]> {
  const response = await get(buildSuggestionsPath(query), options);
  if (!response.ok) {
    throw new Error(`Search suggestions failed (${response.status})`);
  }
  const payload = await readJson(response);
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.flatMap((value) => {
    const row = objectOf(value);
    return row && typeof row.query === "string"
      ? [{ count: numberOf(row.count), query: row.query }]
      : [];
  });
}

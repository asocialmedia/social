// Pure data layer for the profile popup. The session cookie cannot ride a
// plain fetch on native (better-auth keeps it in SecureStore), so callers
// pass the stored cookie string (authClient.getCookie()) and the API base
// (getApiBaseUrl(), which already selects the dev server or prod). Pure and
// injectable for testing, same convention as lib/install-token.ts.
import type { BioLinkPreview } from "./profile-utils";
import { parseLinkPreview } from "./profile-utils";

export interface PopupCommunityRole {
  community?: { slug?: string | null } | null;
  role: string;
}

export interface PopupProfile {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  bannerUrl: string | null;
  bio: string | null;
  communityMemberships: PopupCommunityRole[];
  createdAt: string;
  customDomain: string | null;
  displayName: string | null;
  githubUsername: string | null;
  linkedinUsername: string | null;
  redditUsername: string | null;
  twitterUsername: string | null;
  username: string;
  _count: {
    followers: number;
    following: number;
    posts: number;
  };
}

interface AuthedGetOptions {
  apiBase: string;
  baseFetch?: typeof fetch;
  cookie?: string;
}

interface ProfileFetchOptions extends AuthedGetOptions {
  userId: string;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseProfile(payload: unknown): PopupProfile | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const data = payload as Record<string, unknown>;
  if (typeof data["username"] !== "string" || !data["username"]) {
    return null;
  }
  const count = (data["_count"] ?? {}) as Record<string, unknown>;
  const badges = Array.isArray(data["badges"])
    ? data["badges"].filter(
        (entry: unknown): entry is string => typeof entry === "string"
      )
    : [];
  const communityMemberships = Array.isArray(data["communityMemberships"])
    ? (data["communityMemberships"] as PopupCommunityRole[])
    : [];
  return {
    _count: {
      followers: countOf(count["followers"]),
      following: countOf(count["following"]),
      posts: countOf(count["posts"]),
    },
    aura: countOf(data["aura"]),
    avatarUrl: textOf(data["avatarUrl"]),
    badge: textOf(data["badge"]),
    badges,
    bannerUrl: textOf(data["bannerUrl"]),
    bio: textOf(data["bio"]),
    communityMemberships,
    createdAt: textOf(data["createdAt"]) ?? "",
    customDomain: textOf(data["customDomain"]),
    displayName: textOf(data["displayName"]),
    githubUsername: textOf(data["githubUsername"]),
    linkedinUsername: textOf(data["linkedinUsername"]),
    redditUsername: textOf(data["redditUsername"]),
    twitterUsername: textOf(data["twitterUsername"]),
    username: data["username"],
  };
}

function authedGet(path: string, options: AuthedGetOptions): Promise<Response> {
  const baseFetch = options.baseFetch ?? fetch;
  // Bounded wait: a stalled connection must fail instead of hanging the
  // popup forever. Manual AbortController (not AbortSignal.timeout) so the
  // injected baseFetch in tests needs no timer support.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const headers: Record<string, string> = {};
    if (options.cookie) {
      headers.cookie = options.cookie;
    }
    return baseFetch(`${options.apiBase}${path}`, {
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Loads the full profile projection web's popover renders (UserData). */
export async function fetchPopupProfile(
  options: ProfileFetchOptions
): Promise<PopupProfile> {
  const response = await authedGet(
    `/api/users/${encodeURIComponent(options.userId)}`,
    options
  );
  if (!response.ok) {
    throw new Error(`Profile request failed (${response.status})`);
  }
  const profile = parseProfile(
    (await response.json().catch(() => null)) as unknown
  );
  if (!profile) {
    throw new Error("Profile response was not usable");
  }
  return profile;
}

/** Loads the sidebar bookmark total web shows in the compact bookmarks row. */
export async function fetchBookmarkTotal(
  options: AuthedGetOptions
): Promise<number> {
  const response = await authedGet("/api/bookmarks/count", options);
  if (!response.ok) {
    throw new Error(`Bookmark count request failed (${response.status})`);
  }
  const payload = (await response.json().catch(() => null)) as {
    totalCount?: unknown;
  } | null;
  return countOf(payload?.totalCount);
}

/** Resolves a bio link's preview (title for the pill), or null. */
export async function fetchLinkPreview(
  url: string,
  options: AuthedGetOptions
): Promise<BioLinkPreview | null> {
  const response = await authedGet(
    `/api/link-preview?url=${encodeURIComponent(url)}`,
    options
  );
  if (!response.ok) {
    return null;
  }
  return parseLinkPreview((await response.json().catch(() => null)) as unknown);
}

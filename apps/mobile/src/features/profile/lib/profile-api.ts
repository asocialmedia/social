import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type {
  FeedMedia,
  FeedPost,
  FeedUser,
} from "@/features/feed/lib/feed-types";
import {
  normalizePostData,
  normalizePostsData,
} from "@/features/feed/lib/feed-types";
import { withAuthHeaders } from "@/lib/auth-headers";
import { getWithTimeout } from "@/lib/http-get";

import type { ProfileViewTab } from "./profile-tab-memory";
import type {
  ProfileHeaderProfile,
  ProfileMedia,
  ProfileReply,
} from "./profile-view-model";

export type ProfilePostFilter = "all" | "gusts" | "media";
export type ProfileListKind = "followers" | "following";

export class ProfileApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProfileApiError";
    this.status = status;
  }
}

export interface FollowInfo {
  followers: number;
  isFollowedByUser: boolean;
}

export type FollowMutationResult =
  | ({ kind: "success" } & FollowInfo)
  | { kind: "install-token-required" }
  | { kind: "error"; message: string; status: number };

export interface ProfileUserListItem {
  _count: { followers: number };
  avatarUrl: string | null;
  bio: string | null;
  displayName: string | null;
  id: string;
  isFollowing: boolean;
  username: string;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dateOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return "";
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(response: Response): Promise<unknown> {
  return (await response.json().catch(() => null)) as unknown;
}

function get(path: string, options: ApiCallOptions): Promise<Response> {
  return getWithTimeout(
    `${options.apiBase}${path}`,
    { headers: withAuthHeaders({}, options.cookie) },
    { baseFetch: options.baseFetch ?? fetch, timeoutMs: options.timeoutMs }
  );
}

function feedKind(tab: ProfileViewTab): ProfileFeedPage["kind"] {
  if (tab === "media") {
    return "media";
  }
  return tab === "eddies" ? "replies" : "posts";
}

function cursorValue(payload: Record<string, unknown>): string | null {
  return typeof payload.nextCursor === "string" && payload.nextCursor
    ? payload.nextCursor
    : null;
}

function queryPath(path: string, cursor: string | null): string {
  return cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
}

export function buildProfileUsernamePath(username: string): string {
  return `/api/users/username/${encodeURIComponent(username)}`;
}

export function buildProfilePostsPath(
  userId: string,
  cursor: string | null,
  filter: ProfilePostFilter
): string {
  const path = queryPath(
    `/api/users/${encodeURIComponent(userId)}/posts`,
    cursor
  );
  return `${path}${cursor ? "&" : "?"}filter=${filter}`;
}

export function buildProfileFeedPath(
  userId: string,
  tab: ProfileViewTab,
  cursor: string | null
): string {
  const base = `/api/users/${encodeURIComponent(userId)}`;
  if (tab === "posts" || tab === "gusts") {
    return buildProfilePostsPath(
      userId,
      cursor,
      tab === "gusts" ? "gusts" : "all"
    );
  }
  const endpoint: Record<Exclude<ProfileViewTab, "gusts" | "posts">, string> = {
    amplified: "amplified",
    eddies: "replies",
    media: "media",
    responses: "responses",
  };
  return queryPath(`${base}/${endpoint[tab]}`, cursor);
}
export function parseProfileHeader(
  payload: unknown
): ProfileHeaderProfile | null {
  const user = objectOf(objectOf(payload)?.user ?? payload);
  if (
    !user ||
    typeof user.id !== "string" ||
    typeof user.username !== "string"
  ) {
    return null;
  }
  const count = objectOf(user._count) ?? {};
  const followers = Array.isArray(user.followers)
    ? user.followers.flatMap((entry) => {
        const follower = objectOf(entry);
        return typeof follower?.followerId === "string"
          ? [{ followerId: follower.followerId }]
          : [];
      })
    : [];
  const memberships = Array.isArray(user.communityMemberships)
    ? user.communityMemberships.flatMap((entry) => {
        const membership = objectOf(entry);
        if (!membership || typeof membership.role !== "string") {
          return [];
        }
        const community = objectOf(membership.community);
        return [
          {
            community: community ? { slug: textOf(community.slug) } : null,
            role: membership.role,
          },
        ];
      })
    : [];
  return {
    _count: {
      followers: countOf(count.followers),
      following: countOf(count.following),
      posts: countOf(count.posts),
    },
    aura: countOf(user.aura),
    avatarUrl: textOf(user.avatarUrl),
    badge: textOf(user.badge),
    badges: Array.isArray(user.badges)
      ? user.badges.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : [],
    bannerUrl: textOf(user.bannerUrl),
    bio: textOf(user.bio),
    communityMemberships: memberships,
    createdAt: dateOf(user.createdAt),
    customDomain: textOf(user.customDomain),
    displayName: textOf(user.displayName),
    followers,
    githubUsername: textOf(user.githubUsername),
    id: user.id,
    isFollowing:
      typeof user.isFollowing === "boolean"
        ? user.isFollowing
        : followers.length > 0,
    linkedinUsername: textOf(user.linkedinUsername),
    redditUsername: textOf(user.redditUsername),
    twitterUsername: textOf(user.twitterUsername),
    username: user.username,
  };
}

export function parseFollowInfo(
  payload: unknown,
  fallback?: Partial<FollowInfo>
): FollowInfo {
  const result = objectOf(payload);
  return {
    followers: countOf(result?.followers ?? fallback?.followers),
    isFollowedByUser:
      typeof result?.isFollowedByUser === "boolean"
        ? result.isFollowedByUser
        : (fallback?.isFollowedByUser ?? false),
  };
}

function parsePost(value: unknown): FeedPost | null {
  const post = objectOf(value);
  return post && typeof post.id === "string"
    ? normalizePostData(post as unknown as FeedPost)
    : null;
}

function parseUser(value: unknown): FeedUser | undefined {
  const user = objectOf(value);
  return user && typeof user.id === "string" && user.avatarUrl !== undefined
    ? (user as unknown as FeedUser)
    : undefined;
}

function parseMedia(value: unknown): ProfileMedia | null {
  const media = objectOf(value);
  if (!media || typeof media.id !== "string") {
    return null;
  }
  const post = objectOf(media.post);
  return {
    ...(media as unknown as FeedMedia),
    createdAt: dateOf(media.createdAt),
    post:
      post && typeof post.id === "string"
        ? {
            community:
              typeof objectOf(post.community)?.slug === "string"
                ? { slug: objectOf(post.community)?.slug as string }
                : null,
            explicitContent: post.explicitContent === true,
            id: post.id,
            isGust: post.isGust === true,
            moderated: post.moderated === true,
          }
        : null,
    type: textOf(media.type ?? media._type),
  };
}

function parseReply(value: unknown): ProfileReply | null {
  const reply = objectOf(value);
  const post = parsePost(reply?.post);
  if (!reply || typeof reply.id !== "string" || !post) {
    return null;
  }
  let votes: unknown[] = [];
  if (Array.isArray(reply.votes)) {
    ({ votes } = reply);
  } else if (Array.isArray(reply.vote)) {
    ({ votes } = { votes: reply.vote });
  }
  const parent = objectOf(reply.parent);
  const parentUser = objectOf(parent?.user);
  return {
    attachments: Array.isArray(reply.attachments)
      ? reply.attachments.flatMap((entry) => {
          const attachment = objectOf(entry);
          return attachment && typeof attachment.id === "string"
            ? [{ ...(attachment as unknown as FeedMedia) }]
            : [];
        })
      : [],
    content: textOf(reply.content),
    createdAt: dateOf(reply.createdAt),
    id: reply.id,
    parent:
      parent && typeof parentUser?.username === "string"
        ? { user: { username: parentUser.username } }
        : null,
    post,
    user: parseUser(reply.user),
    votes: votes.flatMap((entry) => {
      const vote = objectOf(entry);
      return vote &&
        typeof vote.userId === "string" &&
        typeof vote.value === "number"
        ? [{ userId: vote.userId, value: vote.value }]
        : [];
    }),
  };
}

export type ProfileFeedPage =
  | { items: FeedPost[]; kind: "posts"; nextCursor: string | null }
  | { items: ProfileMedia[]; kind: "media"; nextCursor: string | null }
  | { items: ProfileReply[]; kind: "replies"; nextCursor: string | null };

export function parseProfileFeedPage(
  payload: unknown,
  kind: ProfileFeedPage["kind"]
): ProfileFeedPage {
  const page = objectOf(payload) ?? {};
  const nextCursor = cursorValue(page);
  if (kind === "media") {
    return {
      items: Array.isArray(page.media)
        ? page.media.flatMap((entry) => {
            const media = parseMedia(entry);
            return media ? [media] : [];
          })
        : [],
      kind,
      nextCursor,
    };
  }
  if (kind === "replies") {
    return {
      items: Array.isArray(page.replies)
        ? page.replies.flatMap((entry) => {
            const reply = parseReply(entry);
            return reply ? [reply] : [];
          })
        : [],
      kind,
      nextCursor,
    };
  }
  return {
    items: Array.isArray(page.posts)
      ? normalizePostsData((page.posts as FeedPost[]).filter(Boolean))
      : [],
    kind: "posts",
    nextCursor,
  };
}

export async function fetchProfileByUsername(
  username: string,
  options: ApiCallOptions
): Promise<ProfileHeaderProfile> {
  const response = await get(buildProfileUsernamePath(username), options);
  const payload = await readJson(response);
  if (!response.ok) {
    throw new ProfileApiError(
      `Profile request failed (${response.status})`,
      response.status
    );
  }
  const profile = parseProfileHeader(payload);
  if (!profile) {
    throw new ProfileApiError(
      "Profile response was not usable",
      response.status
    );
  }
  return profile;
}

export async function fetchFollowInfo(
  userId: string,
  options: ApiCallOptions
): Promise<FollowInfo> {
  const response = await get(
    `/api/users/${encodeURIComponent(userId)}/followers`,
    options
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new ProfileApiError(
      `Follow info request failed (${response.status})`,
      response.status
    );
  }
  return parseFollowInfo(payload);
}

export async function fetchProfileFeedPage(
  userId: string,
  tab: ProfileViewTab,
  cursor: string | null,
  options: ApiCallOptions
): Promise<ProfileFeedPage> {
  const kind = feedKind(tab);
  const response = await get(
    buildProfileFeedPath(userId, tab, cursor),
    options
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new ProfileApiError(
      `Profile feed request failed (${response.status})`,
      response.status
    );
  }
  return parseProfileFeedPage(payload, kind);
}

export async function mutateFollow(
  userId: string,
  follow: boolean,
  options: ApiCallOptions
): Promise<FollowMutationResult> {
  const baseFetch = options.baseFetch ?? fetch;
  const response = await baseFetch(
    `${options.apiBase}/api/users/${encodeURIComponent(userId)}/followers`,
    {
      headers: withAuthHeaders({}, options.cookie),
      method: follow ? "POST" : "DELETE",
    }
  );
  const payload = await readJson(response);
  if (response.ok) {
    return {
      kind: "success",
      ...parseFollowInfo(payload, {
        followers: undefined,
        isFollowedByUser: follow,
      }),
    };
  }
  if (
    response.status === 403 &&
    objectOf(payload)?.error === "install-token-required"
  ) {
    return { kind: "install-token-required" };
  }
  return {
    kind: "error",
    message: `Follow request failed (${response.status})`,
    status: response.status,
  };
}

function parseUserListItem(value: unknown): ProfileUserListItem | null {
  const user = objectOf(value);
  if (
    !user ||
    typeof user.id !== "string" ||
    typeof user.username !== "string"
  ) {
    return null;
  }
  return {
    _count: { followers: countOf(objectOf(user._count)?.followers) },
    avatarUrl: textOf(user.avatarUrl),
    bio: textOf(user.bio),
    displayName: textOf(user.displayName),
    id: user.id,
    isFollowing: user.isFollowing === true,
    username: user.username,
  };
}

export async function fetchProfileUserList(
  userId: string,
  kind: ProfileListKind,
  options: ApiCallOptions
): Promise<ProfileUserListItem[]> {
  const response = await get(
    `/api/users/${encodeURIComponent(userId)}/${kind}-list`,
    options
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new ProfileApiError(
      `${kind} request failed (${response.status})`,
      response.status
    );
  }
  return Array.isArray(payload)
    ? payload.flatMap((entry) => {
        const user = parseUserListItem(entry);
        return user ? [user] : [];
      })
    : [];
}

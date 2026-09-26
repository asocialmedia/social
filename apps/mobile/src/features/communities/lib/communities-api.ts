import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { normalizePostsData } from "@/features/feed/lib/feed-types";
import { getWithTimeout } from "@/lib/http-get";

export const COMMUNITY_DISCOVERY_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "gaming", label: "Gaming" },
  { key: "entertainment", label: "Entertainment" },
  { key: "music", label: "Music" },
  { key: "education", label: "Education" },
  { key: "science_tech", label: "Science & Tech" },
  { key: "art_design", label: "Art & Design" },
  { key: "lifestyle", label: "Lifestyle" },
  { key: "sports", label: "Sports" },
  { key: "society", label: "Society" },
] as const;

export type CommunityCategory =
  (typeof COMMUNITY_DISCOVERY_CATEGORIES)[number]["key"];

export interface CommunityData {
  _count: { members: number; posts: number };
  accentColor: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
  description: string;
  id: string;
  mature: boolean;
  name: string;
  ownerId: string;
  slug: string;
  topics: string[];
  type: string;
  updatedAt: string;
}

export interface CommunityStats {
  communities: number;
  members: number;
  posts: number;
}

export interface CommunitySections {
  growing: CommunityData[];
  trending: CommunityData[];
}

export interface CommunityPage {
  auras: Record<string, number>;
  communities: CommunityData[];
  counts: Record<string, number>;
  joined: CommunityData[];
  nextCursor: string | null;
  sections: CommunitySections;
  stats: CommunityStats;
  total: number;
}

export interface CommunityDetail {
  community: CommunityData;
  membership: { role: string; status: string } | null;
  stats: { communityAura: number; members: number; weeklyVisitors: number };
}

export class CommunityApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CommunityApiError";
    this.status = status;
  }
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

function dateOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return "";
}

function parseCommunity(value: unknown): CommunityData | null {
  const community = objectOf(value);
  if (
    !community ||
    typeof community.id !== "string" ||
    typeof community.name !== "string" ||
    typeof community.slug !== "string"
  ) {
    return null;
  }
  const counts = objectOf(community._count) ?? {};
  return {
    _count: {
      members: countOf(counts.members),
      posts: countOf(counts.posts),
    },
    accentColor: textOf(community.accentColor),
    avatarUrl: textOf(community.avatarUrl),
    bannerUrl: textOf(community.bannerUrl),
    createdAt: dateOf(community.createdAt),
    description: textOf(community.description) ?? "",
    id: community.id,
    mature: community.mature === true,
    name: community.name,
    ownerId: textOf(community.ownerId) ?? "",
    slug: community.slug,
    topics: Array.isArray(community.topics)
      ? community.topics.filter(
          (topic): topic is string => typeof topic === "string"
        )
      : [],
    type: textOf(community.type) ?? "PUBLIC",
    updatedAt: dateOf(community.updatedAt),
  };
}

function parseCommunityList(value: unknown): CommunityData[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const community = parseCommunity(entry);
        return community ? [community] : [];
      })
    : [];
}

function parseNumberMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        result[key] = entry;
      }
    }
  }
  return result;
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
    throw new CommunityApiError(
      `${label} request failed (${response.status})`,
      response.status
    );
  }
}

// Mutations answer with this union rather than throwing, so the caller can tell
// "the server wants an install token" (retry after the Turnstile gate) apart
// from a real failure. Same shape the follow mutation uses.
export type CommunityMutationResult =
  | { kind: "success"; state: CommunityMembershipState }
  | { kind: "install-token-required" }
  | { kind: "error"; message: string; status: number };

export interface CommunityMembershipState {
  canModerate: boolean;
  membership: { role: string; status: string } | null;
  status?: "ACTIVE" | "PENDING";
  subscribed: boolean;
}

export interface CommunityCreationQuota {
  aura: number;
  canCreate: boolean;
  maxed: boolean;
  nextBonus: number;
  nextRequirement: number | null;
  owned: number;
  reachAura: number;
  reachCounted: number;
  standing: number;
}

function parseMembershipState(value: unknown): CommunityMembershipState | null {
  const body = objectOf(value);
  if (!body) {
    return null;
  }
  const { status } = body;
  const membership = objectOf(body.membership);
  return {
    canModerate: body.canModerate === true,
    membership:
      membership &&
      typeof membership.role === "string" &&
      typeof membership.status === "string"
        ? { role: membership.role, status: membership.status }
        : null,
    status: status === "ACTIVE" || status === "PENDING" ? status : undefined,
    subscribed: body.subscribed === true,
  };
}

// One writer for every community mutation, so the install-token branch, the
// session cookie and the error decode exist once instead of per call site.
async function mutateCommunity(
  path: string,
  method: "DELETE" | "PATCH" | "POST",
  body: unknown,
  options: ApiCallOptions,
  label: string
): Promise<CommunityMutationResult> {
  const baseFetch = options.baseFetch ?? fetch;
  const headers: Record<string, string> = options.cookie
    ? { cookie: options.cookie }
    : {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await baseFetch(`${options.apiBase}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
  });
  const payload = await readJson(response);
  if (response.ok) {
    const state = parseMembershipState(payload);
    if (state) {
      return { kind: "success", state };
    }
    // A write that succeeded but returned no membership block (the role
    // endpoint) still has to be reported as a success, so the state the caller
    // already holds stands.
    return {
      kind: "success",
      state: {
        canModerate: false,
        membership: null,
        subscribed: false,
      },
    };
  }
  if (
    response.status === 403 &&
    objectOf(payload)?.error === "install-token-required"
  ) {
    return { kind: "install-token-required" };
  }
  const message = textOf(objectOf(payload)?.error);
  return {
    kind: "error",
    message: message ?? `${label} failed (${response.status})`,
    status: response.status,
  };
}

function communityPath(slug: string, suffix = ""): string {
  return `/api/communities/${encodeURIComponent(slug)}${suffix}`;
}

export function fetchMembershipState(
  slug: string,
  options: ApiCallOptions
): Promise<CommunityMembershipState> {
  return get(communityPath(slug, "/membership"), options).then(
    async (response) => {
      requireOk(response, "Membership");
      const state = parseMembershipState(await readJson(response));
      if (!state) {
        throw new CommunityApiError(
          "Membership response was not usable",
          response.status
        );
      }
      return state;
    }
  );
}

export function joinCommunity(
  slug: string,
  options: ApiCallOptions
): Promise<CommunityMutationResult> {
  return mutateCommunity(
    communityPath(slug, "/membership"),
    "POST",
    undefined,
    options,
    "Join"
  );
}

export function leaveCommunity(
  slug: string,
  options: ApiCallOptions
): Promise<CommunityMutationResult> {
  return mutateCommunity(
    communityPath(slug, "/membership"),
    "DELETE",
    undefined,
    options,
    "Leave"
  );
}

export function setCommunitySubscription(
  slug: string,
  subscribe: boolean,
  options: ApiCallOptions
): Promise<CommunityMutationResult> {
  return mutateCommunity(
    communityPath(slug, "/subscription"),
    subscribe ? "POST" : "DELETE",
    undefined,
    options,
    "Notifications"
  );
}

export function approveCommunityMember(
  slug: string,
  targetUserId: string,
  options: ApiCallOptions
): Promise<CommunityMutationResult> {
  return mutateCommunity(
    communityPath(slug, `/members/${encodeURIComponent(targetUserId)}`),
    "POST",
    undefined,
    options,
    "Approve"
  );
}

export function setCommunityMemberRole(
  slug: string,
  targetUserId: string,
  role: "MEMBER" | "MODERATOR" | "PARTICIPANT",
  options: ApiCallOptions
): Promise<CommunityMutationResult> {
  return mutateCommunity(
    communityPath(slug, `/members/${encodeURIComponent(targetUserId)}`),
    "PATCH",
    { role },
    options,
    "Role change"
  );
}

export async function fetchCreationQuota(
  options: ApiCallOptions
): Promise<CommunityCreationQuota | null> {
  const response = await get("/api/communities/creation-quota", options);
  if (!response.ok) {
    return null;
  }
  const body = objectOf(await readJson(response));
  if (!body) {
    return null;
  }
  return {
    aura: countOf(body.aura),
    canCreate: body.canCreate === true,
    maxed: body.maxed === true,
    nextBonus: countOf(body.nextBonus),
    nextRequirement:
      typeof body.nextRequirement === "number" &&
      Number.isFinite(body.nextRequirement)
        ? body.nextRequirement
        : null,
    owned: countOf(body.owned),
    reachAura: countOf(body.reachAura),
    reachCounted: countOf(body.reachCounted),
    standing: countOf(body.standing),
  };
}

export function buildCommunitiesPath({
  category,
  cursor,
  joined,
  limit = 24,
  query,
}: {
  category: CommunityCategory;
  cursor: string | null;
  joined?: boolean;
  limit?: number;
  query: string;
}): string {
  const params = new URLSearchParams({
    category,
    limit: String(Math.min(48, Math.max(1, limit))),
  });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  if (joined) {
    params.set("joined", "1");
  }
  return `/api/communities?${params.toString()}`;
}

export function parseCommunityPage(payload: unknown): CommunityPage {
  const body = objectOf(payload) ?? {};
  const sections = objectOf(body.sections) ?? {};
  return {
    auras: parseNumberMap(body.auras),
    communities: parseCommunityList(body.communities),
    counts: parseNumberMap(body.counts),
    joined: parseCommunityList(body.joined),
    nextCursor: textOf(body.nextCursor),
    sections: {
      growing: parseCommunityList(sections.growing),
      trending: parseCommunityList(sections.trending),
    },
    stats: {
      communities: countOf(objectOf(body.stats)?.communities),
      members: countOf(objectOf(body.stats)?.members),
      posts: countOf(objectOf(body.stats)?.posts),
    },
    total: countOf(body.total),
  };
}

export async function fetchCommunitiesPage(
  params: {
    category: CommunityCategory;
    cursor: string | null;
    query: string;
  },
  options: ApiCallOptions
): Promise<CommunityPage> {
  const response = await get(buildCommunitiesPath(params), options);
  requireOk(response, "Communities");
  return parseCommunityPage(await readJson(response));
}

export async function fetchCommunityDetail(
  slug: string,
  options: ApiCallOptions
): Promise<CommunityDetail> {
  const response = await get(
    `/api/communities/${encodeURIComponent(slug)}`,
    options
  );
  const payload = await readJson(response);
  requireOk(response, "Community detail");
  const body = objectOf(payload) ?? {};
  const community = parseCommunity(body.community);
  const membership = objectOf(body.membership);
  const stats = objectOf(body.stats) ?? {};
  if (!community) {
    throw new CommunityApiError(
      "Community response was not usable",
      response.status
    );
  }
  return {
    community,
    membership:
      membership &&
      typeof membership.role === "string" &&
      typeof membership.status === "string"
        ? { role: membership.role, status: membership.status }
        : null,
    stats: {
      communityAura: countOf(stats.communityAura),
      members: countOf(stats.members),
      weeklyVisitors: countOf(stats.weeklyVisitors),
    },
  };
}

export async function fetchCommunityPosts(
  slug: string,
  cursor: string | null,
  options: ApiCallOptions
): Promise<{ nextCursor: string | null; posts: FeedPost[] }> {
  const path = `/api/communities/${encodeURIComponent(slug)}/posts?sort=new&excludeModerated=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const response = await get(path, options);
  requireOk(response, "Community posts");
  const body = objectOf(await readJson(response)) ?? {};
  return {
    nextCursor: textOf(body.nextCursor),
    posts: normalizePostsData(
      Array.isArray(body.posts)
        ? body.posts.filter(
            (post): post is FeedPost =>
              objectOf(post)?.id !== undefined &&
              typeof objectOf(post)?.id === "string"
          )
        : []
    ),
  };
}

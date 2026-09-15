// Community domain service. Owns creation, membership, discovery listing, and
// the aggregated stats shown on the community sidebar. Every function here is
// server-only and expects the caller to have already authenticated; the
// authorization checks that depend on the acting user take an explicit
// `actorId` so the rules stay testable without a session object.

import { createLogger } from "@asm/logger";

import type { Prisma } from "../../prisma/generated/prisma/client";
import { COMMUNITY_CREATED_AURA } from "../aura/config";
import { applyFlatAward } from "../aura/ledger";
import { getPostDataInclude } from "../client";
import type { PostData } from "../client";
import prisma from "../prisma";
import {
  COMMUNITY_ACTIVITY_WINDOW_DAYS,
  COMMUNITY_CATEGORIES,
  COMMUNITY_GROWING_WINDOW_DAYS,
  COMMUNITY_LIMITS,
  DEFAULT_COMMUNITY_ACCENT,
  isCommunityAccent,
} from "./constants";
import { normalizeCommunitySlug, isValidCommunitySlug } from "./slug";

const logger = createLogger({ serviceName: "communities" });

// The public shape every community read returns. Stats are computed separately
// (getCommunityStats) because they are expensive and only the detail page
// needs them.
export function getCommunitySelect() {
  return {
    _count: {
      select: {
        members: { where: { status: "ACTIVE" } },
        posts: true,
      },
    },
    accentColor: true,
    avatarUrl: true,
    bannerUrl: true,
    createdAt: true,
    description: true,
    id: true,
    mature: true,
    name: true,
    ownerId: true,
    slug: true,
    topics: true,
    type: true,
  } satisfies Prisma.CommunitySelect;
}

export type CommunityData = Prisma.CommunityGetPayload<{
  select: ReturnType<typeof getCommunitySelect>;
}>;

export interface CommunityStats {
  communityAura: number;
  contributors: number;
  memberAura: number;
  members: number;
  weeklyVisitors: number;
}

export interface CreateCommunityInput {
  accentColor?: string;
  description: string;
  mature?: boolean;
  name: string;
  ownerId: string;
  slug: string;
  topics: string[];
  type?: "PUBLIC" | "RESTRICTED" | "PRIVATE";
}

export class CommunityError extends Error {
  code:
    | "ALREADY_MEMBER"
    | "FORBIDDEN"
    | "INVALID_SLUG"
    | "NOT_FOUND"
    | "SLUG_TAKEN";
  constructor(code: CommunityError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "CommunityError";
  }
}

export async function createCommunity(
  input: CreateCommunityInput
): Promise<CommunityData> {
  const slug = normalizeCommunitySlug(input.slug);
  if (!isValidCommunitySlug(slug)) {
    throw new CommunityError(
      "INVALID_SLUG",
      "That community address is not allowed"
    );
  }

  const name = input.name.trim();
  if (
    name.length < COMMUNITY_LIMITS.nameMin ||
    name.length > COMMUNITY_LIMITS.nameMax
  ) {
    throw new CommunityError(
      "INVALID_SLUG",
      "Community name is the wrong length"
    );
  }

  const existing = await prisma.community.findUnique({
    select: { id: true },
    where: { slug },
  });
  if (existing) {
    throw new CommunityError("SLUG_TAKEN", "That community address is taken");
  }

  const topics = [...new Set(input.topics)].slice(0, COMMUNITY_LIMITS.topicMax);
  const accentColor =
    input.accentColor && isCommunityAccent(input.accentColor)
      ? input.accentColor
      : DEFAULT_COMMUNITY_ACCENT;

  const community = await prisma.$transaction(async (tx) => {
    const created = await tx.community.create({
      data: {
        accentColor,
        description: input.description.trim(),
        mature: input.mature ?? false,
        name,
        ownerId: input.ownerId,
        slug,
        topics,
        type: input.type ?? "PUBLIC",
      },
      select: getCommunitySelect(),
    });

    // The creator is the first ACTIVE member and holds OWNER. Seeding the
    // membership in the same transaction means a community can never exist
    // without its owner being able to post into it.
    await tx.communityMember.create({
      data: {
        communityId: created.id,
        role: "OWNER",
        status: "ACTIVE",
        userId: input.ownerId,
      },
    });

    await applyFlatAward(tx, {
      actorId: input.ownerId,
      baseAmount: COMMUNITY_CREATED_AURA,
      now: new Date(),
      recipientId: input.ownerId,
      subjectToDailyCap: true,
      type: "COMMUNITY_CREATED",
    });

    return created;
  });

  logger.info(
    { communityId: community.id, ownerId: input.ownerId, slug },
    "community created"
  );
  return community;
}

export function getCommunityBySlug(
  slug: string
): Promise<CommunityData | null> {
  return prisma.community.findUnique({
    select: getCommunitySelect(),
    where: { slug: normalizeCommunitySlug(slug) },
  });
}

export function getCommunityById(id: string): Promise<CommunityData | null> {
  return prisma.community.findUnique({
    select: getCommunitySelect(),
    where: { id },
  });
}

export async function getMembership(
  communityId: string,
  userId: string
): Promise<{
  role: "MEMBER" | "MODERATOR" | "OWNER";
  status: "ACTIVE" | "PENDING";
} | null> {
  const member = await prisma.communityMember.findUnique({
    select: { role: true, status: true },
    where: { communityId_userId: { communityId, userId } },
  });
  return member ?? null;
}

export async function canContribute(
  communityId: string,
  userId: string
): Promise<boolean> {
  const membership = await getMembership(communityId, userId);
  return membership?.status === "ACTIVE";
}

export async function isCommunityModerator(
  communityId: string,
  userId: string
): Promise<boolean> {
  const membership = await getMembership(communityId, userId);
  return (
    membership?.status === "ACTIVE" &&
    (membership.role === "OWNER" || membership.role === "MODERATOR")
  );
}

// Public communities join instantly. Restricted and Private communities open a
// PENDING request that an owner/moderator approves; the creator is always
// ACTIVE. Kept here so both the API route and any future surface share it.
export async function joinCommunity(
  communityId: string,
  userId: string
): Promise<{ status: "ACTIVE" | "PENDING" }> {
  const community = await prisma.community.findUnique({
    select: { id: true, type: true },
    where: { id: communityId },
  });
  if (!community) {
    throw new CommunityError("NOT_FOUND", "Community not found");
  }

  const existing = await prisma.communityMember.findUnique({
    select: { status: true },
    where: { communityId_userId: { communityId, userId } },
  });
  if (existing?.status === "ACTIVE") {
    throw new CommunityError("ALREADY_MEMBER", "You are already a member");
  }

  const status = community.type === "PUBLIC" ? "ACTIVE" : "PENDING";
  await prisma.communityMember.upsert({
    create: { communityId, role: "MEMBER", status, userId },
    update: { status },
    where: { communityId_userId: { communityId, userId } },
  });

  logger.info({ communityId, status, userId }, "community join");
  return { status };
}

export async function leaveCommunity(
  communityId: string,
  userId: string
): Promise<void> {
  const membership = await prisma.communityMember.findUnique({
    select: { role: true },
    where: { communityId_userId: { communityId, userId } },
  });
  // The owner cannot abandon a community; ownership transfer is out of scope.
  if (membership?.role === "OWNER") {
    throw new CommunityError(
      "FORBIDDEN",
      "The owner cannot leave their community"
    );
  }
  await prisma.communityMember.deleteMany({ where: { communityId, userId } });
  logger.info({ communityId, userId }, "community leave");
}

export async function approveMember(
  communityId: string,
  actorId: string,
  targetUserId: string
): Promise<void> {
  if (!(await isCommunityModerator(communityId, actorId))) {
    throw new CommunityError(
      "FORBIDDEN",
      "Only moderators can approve members"
    );
  }
  await prisma.communityMember.updateMany({
    data: { status: "ACTIVE" },
    where: { communityId, status: "PENDING", userId: targetUserId },
  });
  logger.info(
    { actorId, communityId, targetUserId },
    "community member approved"
  );
}

export async function setMemberRole(
  communityId: string,
  actorId: string,
  targetUserId: string,
  role: "MODERATOR" | "MEMBER"
): Promise<void> {
  const membership = await getMembership(communityId, actorId);
  if (membership?.role !== "OWNER") {
    throw new CommunityError("FORBIDDEN", "Only the owner can change roles");
  }
  await prisma.communityMember.updateMany({
    data: { role },
    where: { communityId, userId: targetUserId },
  });
  logger.info(
    { actorId, communityId, role, targetUserId },
    "community role set"
  );
}

export interface ListCommunitiesOptions {
  // Cursor is the last community id of the previous page (newest-first order).
  cursor?: string;
  // Topic keys to match (ANY). Empty/absent means every public community.
  // The discovery categories expand to a topic set before calling this.
  categories?: string[];
  limit?: number;
}

export interface CommunitiesPage {
  communities: CommunityData[];
  nextCursor: string | null;
  // Total public communities matching the active filter, ignoring the cursor
  // and page size. Drives the "N Results Found" line on discovery.
  total: number;
}

// Discovery listing: newest first, optionally filtered by a topic set. Private
// communities are excluded because they are not discoverable.
export async function listCommunities(
  options: ListCommunitiesOptions = {}
): Promise<CommunitiesPage> {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 48);
  const topics = options.categories?.filter(Boolean) ?? [];
  const where: Prisma.CommunityWhereInput = {
    type: { not: "PRIVATE" },
    ...(topics.length > 0 ? { topics: { hasSome: topics } } : {}),
  };

  const [communities, total] = await Promise.all([
    prisma.community.findMany({
      cursor: options.cursor ? { id: options.cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: getCommunitySelect(),
      skip: options.cursor ? 1 : 0,
      take: limit + 1,
      where,
    }),
    prisma.community.count({ where }),
  ]);

  const hasMore = communities.length > limit;
  return {
    communities: hasMore ? communities.slice(0, limit) : communities,
    nextCursor: hasMore ? (communities[limit - 1]?.id ?? null) : null,
    total,
  };
}

export interface CommunitySearchResult {
  communities: CommunityData[];
  total: number;
}

export async function searchCommunities(
  query: string,
  limit = 10
): Promise<CommunitySearchResult> {
  const q = query.trim();
  if (!q) {
    return { communities: [], total: 0 };
  }
  const where: Prisma.CommunityWhereInput = {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ],
    type: { not: "PRIVATE" },
  };

  const [communities, total] = await Promise.all([
    prisma.community.findMany({
      orderBy: [{ members: { _count: "desc" } }, { createdAt: "desc" }],
      select: getCommunitySelect(),
      take: Math.min(Math.max(limit, 1), 25),
      where,
    }),
    prisma.community.count({ where }),
  ]);

  return { communities, total };
}

// Per-category public community counts for the discovery filter row. "all" is
// the unfiltered total; every other key counts communities carrying ANY of
// that category's topics. Categories hidden from discovery are skipped so the
// row never pays for a count it will not show.
export async function getCommunityCategoryCounts(): Promise<
  Record<string, number>
> {
  const publicWhere: Prisma.CommunityWhereInput = {
    type: { not: "PRIVATE" },
  };
  const filtered = COMMUNITY_CATEGORIES.filter(
    (c) => c.key !== "all" && !c.hidden
  );
  const [all, perCategory] = await Promise.all([
    prisma.community.count({ where: publicWhere }),
    Promise.all(
      filtered.map((category) =>
        prisma.community.count({
          where: {
            ...publicWhere,
            topics: { hasSome: [...category.topics] },
          },
        })
      )
    ),
  ]);

  const counts: Record<string, number> = { all };
  for (const [index, category] of filtered.entries()) {
    counts[category.key] = perCategory[index] ?? 0;
  }
  return counts;
}

export interface CommunityDiscoveryStats {
  // Public communities (matching the discovery surface).
  communities: number;
  // Posts published into any public community.
  posts: number;
  // Distinct users holding an ACTIVE membership somewhere.
  members: number;
}

// Headline totals for the discovery hero. Counted live over the public set so
// the numbers can never drift from what the grid below actually lists.
export async function getCommunityDiscoveryStats(): Promise<CommunityDiscoveryStats> {
  const publicCommunity: Prisma.CommunityWhereInput = {
    type: { not: "PRIVATE" },
  };
  const [communities, posts, members] = await Promise.all([
    prisma.community.count({ where: publicCommunity }),
    prisma.post.count({ where: { community: publicCommunity } }),
    prisma.communityMember
      .findMany({
        distinct: ["userId"],
        select: { userId: true },
        where: { community: publicCommunity, status: "ACTIVE" },
      })
      .then((rows) => rows.length),
  ]);

  return { communities, members, posts };
}

// Communities the viewer belongs to (ACTIVE only), newest membership first.
export async function getJoinedCommunities(
  userId: string
): Promise<CommunityData[]> {
  const memberships = await prisma.communityMember.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      community: { select: getCommunitySelect() },
    },
    where: { status: "ACTIVE", userId },
  });
  return memberships.map((m) => m.community);
}

export interface CommunitySections {
  growing: CommunityData[];
  trending: CommunityData[];
}

// The population ranking behind the sidebar's "Popular communities" list. This
// is a GLOBAL list, so it is kept out of `getCommunitySections` (which serves
// the grid's rails and is intentionally emptied while searching) - the sidebar
// must not change just because the reader typed in the search box.
export async function getTopCommunities(limit = 6): Promise<CommunityData[]> {
  return await prisma.community.findMany({
    orderBy: [{ members: { _count: "desc" } }, { createdAt: "desc" }],
    select: getCommunitySelect(),
    take: Math.min(Math.max(limit, 1), 24),
    where: { type: { not: "PRIVATE" } },
  });
}

export interface RecentCommunityVisit {
  community: CommunityData;
  visitedAt: Date;
}

// Community aura in one batched pass: the sum of every post's raw aura inside
// each community. This is the community's own output (the sidebar's "Community
// aura"), not the combined wealth of its members, and a single groupBy covers
// a whole page of cards instead of one aggregate per community.
export async function getCommunityAuraMap(
  communityIds: string[]
): Promise<Record<string, number>> {
  const ids = [...new Set(communityIds.filter(Boolean))];
  if (ids.length === 0) {
    return {};
  }

  const rows = await prisma.post.groupBy({
    _sum: { aura: true },
    by: ["communityId"],
    where: { communityId: { in: ids } },
  });

  const auras: Record<string, number> = {};
  for (const id of ids) {
    auras[id] = 0;
  }
  for (const row of rows) {
    if (row.communityId) {
      auras[row.communityId] = row._sum.aura ?? 0;
    }
  }
  return auras;
}

// The curated rails above the browse grid. Trending is ranked by population
// (most joined first); growing is the newest cohort that has actually picked up
// members, so a brand-new empty community cannot sit at the top of the rail.
// A community can only appear on ONE rail: anything shown as growing is
// excluded from trending, so the two rows never repeat the same card.
export async function getCommunitySections({
  limit = 12,
  now = new Date(),
}: {
  limit?: number;
  now?: Date;
} = {}): Promise<CommunitySections> {
  const take = Math.min(Math.max(limit, 1), 24);
  const publicWhere: Prisma.CommunityWhereInput = {
    type: { not: "PRIVATE" },
  };
  const growingSince = new Date(
    now.getTime() - COMMUNITY_GROWING_WINDOW_DAYS * 86_400_000
  );
  const byPopulation: Prisma.CommunityOrderByWithRelationInput[] = [
    { members: { _count: "desc" } },
    { createdAt: "desc" },
  ];

  // Growing is resolved first so its ids can be excluded from the trending
  // query itself (rather than filtered after the fact, which would leave
  // trending short by however many overlapped).
  const growing = await prisma.community.findMany({
    orderBy: byPopulation,
    select: getCommunitySelect(),
    take,
    where: {
      ...publicWhere,
      createdAt: { gte: growingSince },
      members: { some: { status: "ACTIVE" } },
    },
  });

  const trending = await prisma.community.findMany({
    orderBy: byPopulation,
    select: getCommunitySelect(),
    take,
    where: {
      ...publicWhere,
      id: { notIn: growing.map((community) => community.id) },
    },
  });

  return { growing, trending };
}

// Aggregated sidebar stats. Community aura is the sum of its posts' raw aura
// plus the lifetime aura of every active member, so a community reads as the
// combined weight of what it publishes and who it holds. Weekly visitors and
// contributors come from CommunityVisit / CommunityMember over a rolling
// window rather than a denormalized counter.
export async function getCommunityStats(
  communityId: string
): Promise<CommunityStats> {
  const since = new Date(
    Date.now() - COMMUNITY_ACTIVITY_WINDOW_DAYS * 86_400_000
  );

  const [postAura, memberAura, members, contributors, weeklyVisitors] =
    await Promise.all([
      prisma.post.aggregate({
        _sum: { aura: true },
        where: { communityId },
      }),
      prisma.user.aggregate({
        _sum: { aura: true },
        where: {
          communityMemberships: { some: { communityId, status: "ACTIVE" } },
        },
      }),
      prisma.communityMember.count({
        where: { communityId, status: "ACTIVE" },
      }),
      prisma.communityMember.count({
        where: {
          communityId,
          status: "ACTIVE",
          user: { posts: { some: { communityId } } },
        },
      }),
      prisma.communityVisit.count({
        where: { communityId, visitedAt: { gte: since } },
      }),
    ]);

  return {
    communityAura: postAura._sum.aura ?? 0,
    contributors,
    memberAura: memberAura._sum.aura ?? 0,
    members,
    weeklyVisitors,
  };
}

// Records that the viewer visited the community. One row per pair, refreshed
// on each visit so the rolling window stays current without unbounded growth.
export async function recordCommunityVisit(
  communityId: string,
  userId: string
): Promise<void> {
  await prisma.communityVisit.upsert({
    create: { communityId, userId },
    update: { visitedAt: new Date() },
    where: { communityId_userId: { communityId, userId } },
  });
}

// Communities the viewer owns or moderates, used by the wizard / management UI.
export async function getManagedCommunities(
  userId: string
): Promise<CommunityData[]> {
  const memberships = await prisma.communityMember.findMany({
    orderBy: { createdAt: "desc" },
    select: { community: { select: getCommunitySelect() } },
    where: { role: { in: ["OWNER", "MODERATOR"] }, status: "ACTIVE", userId },
  });
  return memberships.map((m) => m.community);
}

export type CommunityFeedSort = "new" | "top";

export interface CommunityFeedOptions {
  communityId: string;
  cursor?: string;
  limit?: number;
  loggedInUserId: string;
  sort?: CommunityFeedSort;
}

// The community's own feed. Native posts only (communityId set); reshares of a
// community post live on the global feed, not here. "new" is chronological,
// "top" ranks by raw post aura.
export async function getCommunityFeedPage(
  options: CommunityFeedOptions
): Promise<{ nextCursor: string | null; posts: PostData[] }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 20);
  const sort = options.sort ?? "new";
  const orderBy: Prisma.PostOrderByWithRelationInput[] =
    sort === "top"
      ? [{ aura: "desc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }];

  const posts = await prisma.post.findMany({
    cursor: options.cursor ? { id: options.cursor } : undefined,
    include: getPostDataInclude(options.loggedInUserId),
    orderBy,
    skip: options.cursor ? 1 : 0,
    take: limit + 1,
    where: { communityId: options.communityId, isGust: false },
  });

  const hasMore = posts.length > limit;
  return {
    nextCursor: hasMore ? (posts[limit - 1]?.id ?? null) : null,
    posts: posts.slice(0, limit),
  };
}

// Highest-aura communities: rank by the sum of their posts' raw aura, then
// hydrate the winners. A groupBy first keeps this to two queries (the ranking
// plus one fetch) rather than probing every community.
export async function getTopCommunitiesByAura(
  limit = 6
): Promise<CommunityData[]> {
  const take = Math.min(Math.max(limit, 1), 24);
  const ranked = await prisma.post.groupBy({
    _sum: { aura: true },
    by: ["communityId"],
    orderBy: { _sum: { aura: "desc" } },
    take,
    where: { communityId: { not: null } },
  });

  const ids = ranked
    .map((row) => row.communityId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    return [];
  }

  const communities = await prisma.community.findMany({
    select: getCommunitySelect(),
    where: { id: { in: ids }, type: { not: "PRIVATE" } },
  });

  // Preserve the aura ranking: findMany returns arbitrary DB order.
  const byId = new Map(
    communities.map((community) => [community.id, community])
  );
  return ids
    .map((id) => byId.get(id))
    .filter((community): community is CommunityData => Boolean(community));
}

export interface ActiveCategory {
  count: number;
  key: string;
  label: string;
  // Topic keys of the winning category, so callers can filter the browse grid.
  topics: string[];
}

// The category with the most published posts - "most active" measured by
// output rather than by member count. Counts run per category in one batched
// pass; a tie falls to the earlier category, which keeps the label stable
// instead of flickering between equal shelves.
export async function getMostActiveCategory(): Promise<ActiveCategory | null> {
  const categories = COMMUNITY_CATEGORIES.filter((c) => c.key !== "all");
  const counts = await Promise.all(
    categories.map((category) =>
      prisma.post.count({
        where: {
          community: {
            topics: { hasSome: [...category.topics] },
            type: { not: "PRIVATE" },
          },
        },
      })
    )
  );

  let bestIndex = -1;
  for (const [index, count] of counts.entries()) {
    if (count > 0 && (bestIndex === -1 || count > (counts[bestIndex] ?? 0))) {
      bestIndex = index;
    }
  }
  if (bestIndex === -1) {
    return null;
  }

  const best = categories[bestIndex];
  return {
    count: counts[bestIndex] ?? 0,
    key: best.key,
    label: best.label,
    topics: [...best.topics],
  };
}

// The viewer's most recently visited communities, newest first, each carrying
// the visit time so the sidebar can show how long ago. One row per (community,
// viewer) is refreshed on each visit, so this reading is the person's own
// recent trail rather than a global feed.
export async function getRecentlyVisitedCommunities(
  userId: string,
  limit = 6
): Promise<RecentCommunityVisit[]> {
  if (!userId) {
    return [];
  }
  const visits = await prisma.communityVisit.findMany({
    orderBy: { visitedAt: "desc" },
    select: {
      community: { select: getCommunitySelect() },
      visitedAt: true,
    },
    take: Math.min(Math.max(limit, 1), 24),
    where: {
      community: { type: { not: "PRIVATE" } },
      userId,
    },
  });
  return visits.map((visit) => ({
    community: visit.community,
    visitedAt: visit.visitedAt,
  }));
}

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
  cursor?: string;
  limit?: number;
  topic?: string;
}

// Discovery listing: newest first, optionally filtered by topic. Private
// communities are excluded because they are not discoverable.
export async function listCommunities(
  options: ListCommunitiesOptions = {}
): Promise<{ communities: CommunityData[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 48);
  const communities = await prisma.community.findMany({
    cursor: options.cursor ? { id: options.cursor } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: getCommunitySelect(),
    skip: options.cursor ? 1 : 0,
    take: limit + 1,
    where: {
      type: { not: "PRIVATE" },
      ...(options.topic ? { topics: { has: options.topic } } : {}),
    },
  });

  const hasMore = communities.length > limit;
  return {
    communities: hasMore ? communities.slice(0, limit) : communities,
    nextCursor: hasMore ? (communities[limit - 1]?.id ?? null) : null,
  };
}

export async function searchCommunities(
  query: string,
  limit = 10
): Promise<CommunityData[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }
  return await prisma.community.findMany({
    orderBy: [{ members: { _count: "desc" } }, { createdAt: "desc" }],
    select: getCommunitySelect(),
    take: Math.min(Math.max(limit, 1), 25),
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
      type: { not: "PRIVATE" },
    },
  });
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

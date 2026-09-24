import { randomUUID } from "node:crypto";

import { createLogger } from "@asm/logger";
import type { ResultType } from "@prisma/orm-postgres/components/runtime";
import { and, or } from "@prisma/orm-postgres/orm-client";
import type { ModelAccessor } from "@prisma/orm-postgres/orm-client";
import type { AnyExpression } from "@prisma/orm-postgres/relational-core/ast";

import type { Contract } from "../../generated/prisma/contract";
import {
  COMMUNITY_JOIN_AURA,
  COMMUNITY_JOIN_DAILY_AURA_CAP,
  COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS,
  COMMUNITY_JOIN_OWNER_AURA,
} from "../aura/config";
import { applyFlatAward } from "../aura/ledger";
import { computeStandingForUser, getCommunityStanding } from "../aura/standing";
import { getPostDataQuery, mapPostData } from "../client";
import prisma, { fromPrismaDateTime, toPrismaDateTime } from "../prisma";
import type { PrismaOrm, PrismaTransaction } from "../prisma";
import {
  COMMUNITY_ACTIVITY_WINDOW_DAYS,
  COMMUNITY_CATEGORIES,
  COMMUNITY_GROWING_WINDOW_DAYS,
  COMMUNITY_LIMITS,
  COMMUNITY_MAX_MODERATORS,
  COMMUNITY_MAX_OWNED,
  communityCreationAuraRequirement,
  communityFoundingBonus,
  DEFAULT_COMMUNITY_ACCENT,
  isCommunityAccent,
} from "./constants";
import { planCommunityNotification } from "./notification-plan";
import { isValidCommunitySlug, normalizeCommunitySlug } from "./slug";

const logger = createLogger({ serviceName: "communities" });

export type CommunityRoleValue =
  | "MEMBER"
  | "MODERATOR"
  | "OWNER"
  | "PARTICIPANT";

export interface CommunityMembership {
  role: CommunityRoleValue;
  status: "ACTIVE" | "PENDING";
}

export function getCommunitySelect(orm: PrismaOrm = prisma.orm) {
  return orm.public.Communities.select(
    "accentColor",
    "avatarUrl",
    "bannerUrl",
    "createdAt",
    "description",
    "id",
    "mature",
    "name",
    "ownerId",
    "slug",
    "topics",
    "_type",
    "updatedAt"
  )
    .include("communityMembers", (members) =>
      members.where((member) => member.status.eq("ACTIVE")).count()
    )
    .include("posts", (posts) => posts.count());
}

type CommunityQueryData = ResultType<ReturnType<typeof getCommunitySelect>>;

export interface CommunityData extends Omit<
  CommunityQueryData,
  "_type" | "communityMembers" | "createdAt" | "posts" | "updatedAt"
> {
  _count: { members: number; posts: number };
  createdAt: Date;
  type: CommunityQueryData["_type"];
  updatedAt: Date;
}

function mapCommunityData(row: CommunityQueryData): CommunityData {
  const { _type, communityMembers, createdAt, posts, updatedAt, ...scalars } =
    row;
  return {
    ...scalars,
    _count: { members: communityMembers, posts },
    createdAt: fromPrismaDateTime(createdAt),
    type: _type,
    updatedAt: fromPrismaDateTime(updatedAt),
  };
}

type CommunityPredicate = (
  community: ModelAccessor<Contract, "Communities", "public">
) => AnyExpression;

async function findCommunityBy(
  predicate: CommunityPredicate
): Promise<CommunityData | null> {
  const row = await getCommunitySelect().where(predicate).first();
  return row ? mapCommunityData(row) : null;
}

export interface CommunityStats {
  communityAura: number;
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
    | "AURA_TOO_LOW"
    | "FORBIDDEN"
    | "INVALID_ROLE"
    | "INVALID_SLUG"
    | "LIMIT_REACHED"
    | "MOD_LIMIT_REACHED"
    | "NOT_FOUND"
    | "SLUG_TAKEN";
  constructor(code: CommunityError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "CommunityError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "23505";
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
}

async function claimUserMutation(
  transaction: PrismaTransaction,
  userId: string
): Promise<void> {
  const user = await transaction.orm.public.Users.select("updatedAt")
    .where({ id: userId })
    .first();
  if (!user) {
    throw new Error(`Cannot mutate missing user ${userId}`);
  }
  const claimed = await transaction.orm.public.Users.where((candidate) =>
    and(candidate.id.eq(userId), candidate.updatedAt.eq(user.updatedAt))
  ).updateAndCount({ updatedAt: user.updatedAt });
  return claimed === 1 ? undefined : claimUserMutation(transaction, userId);
}

async function claimCommunityMutation(
  transaction: PrismaTransaction,
  communityId: string
): Promise<void> {
  const community = await transaction.orm.public.Communities.select("updatedAt")
    .where({ id: communityId })
    .first();
  if (!community) {
    return;
  }
  const claimed = await transaction.orm.public.Communities.where((candidate) =>
    and(
      candidate.id.eq(communityId),
      candidate.updatedAt.eq(community.updatedAt)
    )
  ).updateAndCount({ updatedAt: community.updatedAt });
  return claimed === 1
    ? undefined
    : claimCommunityMutation(transaction, communityId);
}

async function grantCommunityJoinBonus(
  transaction: PrismaTransaction,
  input: { communityId: string; ownerId: string; userId: string }
): Promise<void> {
  if (input.userId === input.ownerId) {
    return;
  }

  const now = new Date();
  const joiner = await transaction.orm.public.Users.select("createdAt")
    .where({ id: input.userId })
    .first();
  const createdAt = joiner ? fromPrismaDateTime(joiner.createdAt) : now;
  const accountAgeDays = (now.getTime() - createdAt.getTime()) / 86_400_000;
  if (accountAgeDays < COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS) {
    return;
  }

  await claimUserMutation(transaction, input.userId);
  const earnedToday = await transaction.orm.public.CommunityJoinBonuses.where(
    (bonus) =>
      and(
        bonus.createdAt.gte(toPrismaDateTime(startOfUtcDay(now))),
        bonus.userId.eq(input.userId)
      )
  ).aggregate((aggregate) => ({ total: aggregate.sum("joinerAura") }));
  const paidToday = earnedToday.total ?? 0;
  const withinCap =
    paidToday + COMMUNITY_JOIN_AURA <= COMMUNITY_JOIN_DAILY_AURA_CAP;
  const joinerAura = withinCap ? COMMUNITY_JOIN_AURA : 0;
  const ownerAura = withinCap ? COMMUNITY_JOIN_OWNER_AURA : 0;

  const markerId = randomUUID();
  const marker = await transaction.orm.public.CommunityJoinBonuses.upsert({
    conflictOn: {
      communityId: input.communityId,
      userId: input.userId,
    },
    create: {
      communityId: input.communityId,
      id: markerId,
      joinerAura,
      ownerAura,
      userId: input.userId,
    },
    update: {},
  });
  if (marker.id !== markerId) {
    return;
  }

  if (joinerAura > 0) {
    await applyFlatAward(transaction, {
      actorId: input.ownerId,
      baseAmount: joinerAura,
      now,
      recipientId: input.userId,
      subjectToDailyCap: false,
      type: "COMMUNITY_JOIN",
    });
  }

  if (ownerAura > 0) {
    await applyFlatAward(transaction, {
      actorId: input.userId,
      baseAmount: ownerAura,
      now,
      recipientId: input.ownerId,
      subjectToDailyCap: false,
      type: "COMMUNITY_JOIN_OWNER",
    });
  }

  logger.info(
    {
      communityId: input.communityId,
      joinerAura,
      ownerAura,
      userId: input.userId,
    },
    "community join bonus"
  );
}

export interface CommunityCreationQuota {
  owned: number;
  aura: number;
  standing: number;
  reachAura: number;
  reachCounted: number;
  nextRequirement: number | null;
  nextBonus: number;
  canCreate: boolean;
  maxed: boolean;
}

export async function getCommunityCreationQuota(
  userId: string
): Promise<CommunityCreationQuota> {
  const [standing, owned] = await Promise.all([
    getCommunityStanding(userId),
    prisma.orm.public.Communities.where({ ownerId: userId }).aggregate(
      (aggregate) => ({ count: aggregate.count() })
    ),
  ]);
  const ownedCount = owned.count;
  const nextRequirement = communityCreationAuraRequirement(ownedCount);
  const maxed = ownedCount >= COMMUNITY_MAX_OWNED;
  return {
    aura: standing.aura,
    canCreate:
      !maxed &&
      nextRequirement !== null &&
      standing.standing >= nextRequirement,
    maxed,
    nextBonus: communityFoundingBonus(ownedCount),
    nextRequirement,
    owned: ownedCount,
    reachAura: standing.reachAura,
    reachCounted: standing.reachCounted,
    standing: standing.standing,
  };
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

  const existing = await prisma.orm.public.Communities.where({ slug }).first();
  const existingCommunity = existing ?? null;
  if (existingCommunity) {
    throw new CommunityError("SLUG_TAKEN", "That community address is taken");
  }

  const topics = [...new Set(input.topics)].slice(0, COMMUNITY_LIMITS.topicMax);
  const accentColor =
    input.accentColor && isCommunityAccent(input.accentColor)
      ? input.accentColor
      : DEFAULT_COMMUNITY_ACCENT;

  const community = await prisma.transaction(async (transaction) => {
    await claimUserMutation(transaction, input.ownerId);
    const owned = await transaction.orm.public.Communities.where({
      ownerId: input.ownerId,
    }).aggregate((aggregate) => ({ count: aggregate.count() }));
    const requirement = communityCreationAuraRequirement(owned.count);
    if (requirement === null) {
      throw new CommunityError(
        "LIMIT_REACHED",
        `You've reached the limit of ${COMMUNITY_MAX_OWNED} communities`
      );
    }

    const standing = await computeStandingForUser(
      transaction.orm,
      input.ownerId
    );
    if (standing.standing < requirement) {
      throw new CommunityError(
        "AURA_TOO_LOW",
        `Founding this community needs ${requirement} standing. You have ${standing.standing}.`
      );
    }

    let created: CommunityData;
    try {
      const row = await getCommunitySelect(transaction.orm).create({
        _type: input.type ?? "PUBLIC",
        accentColor,
        description: input.description.trim(),
        mature: input.mature ?? false,
        name,
        ownerId: input.ownerId,
        slug,
        topics,
      });
      created = mapCommunityData(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new CommunityError(
          "SLUG_TAKEN",
          "That community address is taken"
        );
      }
      throw error;
    }

    await transaction.orm.public.CommunityMembers.create({
      communityId: created.id,
      role: "OWNER",
      status: "ACTIVE",
      userId: input.ownerId,
    });

    await applyFlatAward(transaction, {
      actorId: input.ownerId,
      baseAmount: communityFoundingBonus(owned.count),
      now: new Date(),
      recipientId: input.ownerId,
      subjectToDailyCap: false,
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
  return findCommunityBy((community) =>
    community.slug.eq(normalizeCommunitySlug(slug))
  );
}

export function getCommunityById(id: string): Promise<CommunityData | null> {
  return findCommunityBy((community) => community.id.eq(id));
}

export function getMembership(
  communityId: string,
  userId: string
): Promise<CommunityMembership | null> {
  return prisma.orm.public.CommunityMembers.select("role", "status")
    .where((member) =>
      and(member.communityId.eq(communityId), member.userId.eq(userId))
    )
    .first();
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

export async function canViewCommunity(
  community: { id: string; type: CommunityData["type"] },
  userId: string
): Promise<boolean> {
  if (community.type !== "PRIVATE") {
    return true;
  }
  if (!userId) {
    return false;
  }
  const membership = await getMembership(community.id, userId);
  return membership?.status === "ACTIVE";
}

export async function canViewCommunityById(
  communityId: string,
  userId: string
): Promise<boolean> {
  const community = await prisma.orm.public.Communities.select("id", "_type")
    .where({ id: communityId })
    .first();
  if (!community) {
    return false;
  }
  return canViewCommunity({ id: community.id, type: community._type }, userId);
}

export { communityVisibilityWhere } from "./visibility";

export async function joinCommunity(
  communityId: string,
  userId: string
): Promise<{ status: "ACTIVE" | "PENDING" }> {
  const community = await prisma.orm.public.Communities.select(
    "id",
    "ownerId",
    "_type"
  )
    .where({ id: communityId })
    .first();
  if (!community) {
    throw new CommunityError("NOT_FOUND", "Community not found");
  }

  const existing = await prisma.orm.public.CommunityMembers.select("status")
    .where((member) =>
      and(member.communityId.eq(communityId), member.userId.eq(userId))
    )
    .first();
  if (existing?.status === "ACTIVE") {
    throw new CommunityError("ALREADY_MEMBER", "You are already a member");
  }

  const status = community._type === "PUBLIC" ? "ACTIVE" : "PENDING";
  await prisma.transaction(async (transaction) => {
    await transaction.orm.public.CommunityMembers.upsert({
      conflictOn: { communityId, userId },
      create: {
        communityId,
        role: "PARTICIPANT",
        status,
        userId,
      },
      update: { status },
    });
    if (status === "ACTIVE") {
      await grantCommunityJoinBonus(transaction, {
        communityId,
        ownerId: community.ownerId,
        userId,
      });
    }
  });

  logger.info({ communityId, status, userId }, "community join");
  return { status };
}

export async function leaveCommunity(
  communityId: string,
  userId: string
): Promise<void> {
  const [membership, community] = await Promise.all([
    prisma.orm.public.CommunityMembers.select("role")
      .where((member) =>
        and(member.communityId.eq(communityId), member.userId.eq(userId))
      )
      .first(),
    prisma.orm.public.Communities.select("_type")
      .where({ id: communityId })
      .first(),
  ]);
  if (membership?.role === "OWNER") {
    throw new CommunityError(
      "FORBIDDEN",
      "The owner cannot leave their community"
    );
  }

  await prisma.transaction(async (transaction) => {
    await claimCommunityMutation(transaction, communityId);
    await transaction.orm.public.CommunityMembers.where((member) =>
      and(member.communityId.eq(communityId), member.userId.eq(userId))
    ).deleteAndCount();

    if (community?._type === "PRIVATE") {
      await transaction.orm.public.CommunitySubscriptions.where(
        (subscription) =>
          and(
            subscription.communityId.eq(communityId),
            subscription.userId.eq(userId)
          )
      ).deleteAndCount();
      await transaction.orm.public.Notifications.where((notification) =>
        and(
          notification.communityId.eq(communityId),
          notification.recipientId.eq(userId),
          notification._type.eq("COMMUNITY_POST")
        )
      ).deleteAndCount();
    }
  });

  logger.info({ communityId, userId }, "community leave");
}

const MAX_COMMUNITY_NOTIFY_FANOUT = 5000;

export async function subscribeToCommunity(
  communityId: string,
  userId: string
): Promise<void> {
  const community = await prisma.orm.public.Communities.select("_type")
    .where({ id: communityId })
    .first();
  if (!community) {
    throw new CommunityError("NOT_FOUND", "Community not found");
  }
  if (community._type === "PRIVATE") {
    const membership = await prisma.orm.public.CommunityMembers.select("status")
      .where((member) =>
        and(member.communityId.eq(communityId), member.userId.eq(userId))
      )
      .first();
    if (membership?.status !== "ACTIVE") {
      throw new CommunityError("NOT_FOUND", "Community not found");
    }
  }

  await prisma.orm.public.CommunitySubscriptions.upsert({
    conflictOn: { communityId, userId },
    create: { communityId, userId },
    update: {},
  });
  logger.info({ communityId, userId }, "community subscribe");
}

export async function unsubscribeFromCommunity(
  communityId: string,
  userId: string
): Promise<void> {
  await prisma.orm.public.CommunitySubscriptions.where((subscription) =>
    and(
      subscription.communityId.eq(communityId),
      subscription.userId.eq(userId)
    )
  ).deleteAndCount();
  logger.info({ communityId, userId }, "community unsubscribe");
}

export async function isSubscribedToCommunity(
  communityId: string,
  userId: string
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const subscription = await prisma.orm.public.CommunitySubscriptions.select(
    "id"
  )
    .where((candidate) =>
      and(candidate.communityId.eq(communityId), candidate.userId.eq(userId))
    )
    .first();
  return Boolean(subscription);
}

async function selectNotifiableSubscriberIds(
  orm: PrismaOrm,
  communityId: string,
  excludeUserId: string
): Promise<string[]> {
  const community = await orm.public.Communities.select("_type")
    .where({ id: communityId })
    .first();
  const subscriptions = await orm.public.CommunitySubscriptions.select("userId")
    .where((subscription) => {
      const conditions = [subscription.communityId.eq(communityId)];
      if (excludeUserId) {
        conditions.push(subscription.userId.neq(excludeUserId));
      }
      if (community?._type === "PRIVATE") {
        conditions.push(
          subscription.user.some((user) =>
            user.communityMembers.some((member) =>
              and(
                member.communityId.eq(communityId),
                member.status.eq("ACTIVE")
              )
            )
          )
        );
      }
      return and(...conditions);
    })
    .limit(MAX_COMMUNITY_NOTIFY_FANOUT)
    .all();
  return subscriptions.map((subscription) => subscription.userId);
}

export function getCommunitySubscriberIds(
  communityId: string,
  excludeUserId: string
): Promise<string[]> {
  return selectNotifiableSubscriberIds(prisma.orm, communityId, excludeUserId);
}

export async function notifyCommunitySubscribers(
  transaction: PrismaTransaction,
  input: { authorId: string; communityId: string; postId: string }
): Promise<{ id: string; recipientId: string }[]> {
  await claimCommunityMutation(transaction, input.communityId);
  const recipientIds = await selectNotifiableSubscriberIds(
    transaction.orm,
    input.communityId,
    input.authorId
  );
  if (recipientIds.length === 0) {
    return [];
  }

  const existing = await transaction.orm.public.Notifications.select(
    "recipientId",
    "count"
  )
    .where((notification) =>
      and(
        notification.communityId.eq(input.communityId),
        notification.read.eq(false),
        notification.recipientId.in(recipientIds),
        notification._type.eq("COMMUNITY_POST")
      )
    )
    .all();
  const { fold, fresh } = planCommunityNotification(
    recipientIds,
    existing.map((notification) => notification.recipientId)
  );

  if (fold.length > 0) {
    const now = toPrismaDateTime(new Date());
    await Promise.all(
      existing
        .filter((notification) => fold.includes(notification.recipientId))
        .map((notification) =>
          transaction.orm.public.Notifications.where((candidate) =>
            and(
              candidate.communityId.eq(input.communityId),
              candidate.read.eq(false),
              candidate.recipientId.eq(notification.recipientId),
              candidate._type.eq("COMMUNITY_POST")
            )
          ).updateAndCount({
            count: notification.count + 1,
            createdAt: now,
            postId: input.postId,
          })
        )
    );
  }

  if (fresh.length === 0) {
    return [];
  }

  const rows = await transaction.orm.public.Notifications.createAll(
    fresh.map((recipientId) => ({
      _type: "COMMUNITY_POST" as const,
      communityId: input.communityId,
      count: 1,
      issuerId: input.authorId,
      postId: input.postId,
      recipientId,
    }))
  );
  return rows.map((row) => ({ id: row.id, recipientId: row.recipientId }));
}

export async function getSubscribedCommunityIds(
  userId: string
): Promise<string[]> {
  if (!userId) {
    return [];
  }
  const subscriptions = await prisma.orm.public.CommunitySubscriptions.select(
    "communityId"
  )
    .where((subscription) =>
      and(
        subscription.userId.eq(userId),
        subscription.community.some((community) =>
          or(
            community._type.neq("PRIVATE"),
            community.communityMembers.some((member) =>
              and(member.status.eq("ACTIVE"), member.userId.eq(userId))
            )
          )
        )
      )
    )
    .all();
  return subscriptions.map((subscription) => subscription.communityId);
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

  const community = await prisma.orm.public.Communities.select("ownerId")
    .where({ id: communityId })
    .first();
  if (!community) {
    throw new CommunityError("NOT_FOUND", "Community not found");
  }

  await prisma.transaction(async (transaction) => {
    const updated = await transaction.orm.public.CommunityMembers.where(
      (member) =>
        and(
          member.communityId.eq(communityId),
          member.status.eq("PENDING"),
          member.userId.eq(targetUserId)
        )
    ).updateAndCount({ status: "ACTIVE" });
    if (updated > 0) {
      await grantCommunityJoinBonus(transaction, {
        communityId,
        ownerId: community.ownerId,
        userId: targetUserId,
      });
    }
  });

  logger.info(
    { actorId, communityId, targetUserId },
    "community member approved"
  );
}

export type AssignableCommunityRole = "MEMBER" | "MODERATOR" | "PARTICIPANT";
const ASSIGNABLE_ROLES = new Set<AssignableCommunityRole>([
  "MEMBER",
  "MODERATOR",
  "PARTICIPANT",
]);

export async function setMemberRole(
  communityId: string,
  actorId: string,
  targetUserId: string,
  role: AssignableCommunityRole
): Promise<void> {
  if (!ASSIGNABLE_ROLES.has(role)) {
    throw new CommunityError("INVALID_ROLE", "That role cannot be assigned");
  }

  const [actor, target, community] = await Promise.all([
    getMembership(communityId, actorId),
    getMembership(communityId, targetUserId),
    prisma.orm.public.Communities.select("ownerId")
      .where({ id: communityId })
      .first(),
  ]);
  if (!community) {
    throw new CommunityError("NOT_FOUND", "Community not found");
  }

  const isOwner = actor?.status === "ACTIVE" && actor.role === "OWNER";
  const isMod = actor?.status === "ACTIVE" && actor.role === "MODERATOR";
  if (!isOwner && !isMod) {
    throw new CommunityError(
      "FORBIDDEN",
      "Only the owner or a moderator can change roles"
    );
  }
  if (!isOwner && role === "MODERATOR") {
    throw new CommunityError(
      "FORBIDDEN",
      "Only the owner can appoint moderators"
    );
  }
  if (!target) {
    throw new CommunityError("NOT_FOUND", "That person is not a member");
  }
  if (target.role === "OWNER" || targetUserId === community.ownerId) {
    throw new CommunityError("FORBIDDEN", "The owner's role cannot be changed");
  }

  await prisma.transaction(async (transaction) => {
    await claimCommunityMutation(transaction, communityId);
    const currentTarget = await transaction.orm.public.CommunityMembers.select(
      "role"
    )
      .where((member) =>
        and(member.communityId.eq(communityId), member.userId.eq(targetUserId))
      )
      .first();
    if (!currentTarget) {
      throw new CommunityError("NOT_FOUND", "That person is not a member");
    }

    if (role === "MODERATOR" && currentTarget.role !== "MODERATOR") {
      const moderators = await transaction.orm.public.CommunityMembers.where(
        (member) =>
          and(
            member.communityId.eq(communityId),
            member.role.eq("MODERATOR"),
            member.status.eq("ACTIVE")
          )
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
      if (moderators.count >= COMMUNITY_MAX_MODERATORS) {
        throw new CommunityError(
          "MOD_LIMIT_REACHED",
          `A community can have at most ${COMMUNITY_MAX_MODERATORS} moderators`
        );
      }
    }

    await transaction.orm.public.CommunityMembers.where((member) =>
      and(member.communityId.eq(communityId), member.userId.eq(targetUserId))
    ).updateAndCount({ role });
  });

  logger.info(
    { actorId, communityId, role, targetUserId },
    "community role set"
  );
}

export interface ListCommunitiesOptions {
  cursor?: string;
  categories?: string[];
  limit?: number;
}

export interface CommunitiesPage {
  communities: CommunityData[];
  nextCursor: string | null;
  total: number;
}

function hasAnyTopic(
  communityTopics: readonly string[] | null,
  expectedTopics: readonly string[]
): boolean {
  const expected = new Set(expectedTopics);
  return communityTopics?.some((topic) => expected.has(topic)) ?? false;
}

function compareCommunityActivity(left: CommunityData, right: CommunityData) {
  const memberDifference = right._count.members - left._count.members;
  if (memberDifference !== 0) {
    return memberDifference;
  }
  const createdDifference =
    right.createdAt.getTime() - left.createdAt.getTime();
  return createdDifference || left.id.localeCompare(right.id);
}

async function queryCommunityRows(options: {
  cursor?: string;
  limit: number;
  orderByMemberCount?: boolean;
  query?: string;
  topics?: string[];
}): Promise<{ communities: CommunityData[]; total: number }> {
  const pattern = options.query
    ? `%${options.query.replaceAll(/[\\%_]/g, "\\$&")}%`
    : null;
  const rows = await getCommunitySelect()
    .where((community) => {
      const conditions = [community._type.neq("PRIVATE")];
      if (pattern) {
        conditions.push(
          or(
            community.name.ilike(pattern),
            community.slug.ilike(pattern),
            community.description.ilike(pattern)
          )
        );
      }
      return and(...conditions);
    })
    .orderBy([
      (community) => community.createdAt.desc(),
      (community) => community.id.desc(),
    ])
    .all();
  const filtered = rows
    .map(mapCommunityData)
    .filter(
      (community) =>
        !options.topics?.length || hasAnyTopic(community.topics, options.topics)
    );
  const ordered = options.orderByMemberCount
    ? filtered.toSorted(compareCommunityActivity)
    : filtered;
  const cursorIndex = options.cursor
    ? ordered.findIndex((community) => community.id === options.cursor)
    : -1;
  let start = 0;
  if (options.cursor) {
    start = cursorIndex < 0 ? ordered.length : cursorIndex + 1;
  }
  return {
    communities: ordered.slice(start, start + options.limit),
    total: filtered.length,
  };
}

export async function listCommunities(
  options: ListCommunitiesOptions = {}
): Promise<CommunitiesPage> {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 48);
  const topics = options.categories?.filter(Boolean) ?? [];
  const result = await queryCommunityRows({
    cursor: options.cursor,
    limit: limit + 1,
    topics,
  });
  const hasMore = result.communities.length > limit;
  return {
    communities: hasMore
      ? result.communities.slice(0, limit)
      : result.communities,
    nextCursor: hasMore ? (result.communities[limit - 1]?.id ?? null) : null,
    total: result.total,
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
  const result = await queryCommunityRows({
    limit: Math.min(Math.max(limit, 1), 25),
    orderByMemberCount: true,
    query: q,
  });
  return result;
}

export async function getCommunityCategoryCounts(): Promise<
  Record<string, number>
> {
  const filtered = COMMUNITY_CATEGORIES.filter(
    (category) => category.key !== "all" && !category.hidden
  );
  const communities = await prisma.orm.public.Communities.select("topics")
    .where((community) => community._type.neq("PRIVATE"))
    .all();
  const result: Record<string, number> = { all: communities.length };
  for (const category of filtered) {
    result[category.key] = communities.filter((community) =>
      hasAnyTopic(community.topics, category.topics)
    ).length;
  }
  return result;
}

export interface CommunityDiscoveryStats {
  communities: number;
  posts: number;
  members: number;
}

export async function getCommunityDiscoveryStats(): Promise<CommunityDiscoveryStats> {
  const [communities, posts, members] = await Promise.all([
    prisma.orm.public.Communities.where((community) =>
      community._type.neq("PRIVATE")
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
    prisma.orm.public.Posts.where((post) =>
      post.community.some((community) => community._type.neq("PRIVATE"))
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
    prisma.orm.public.CommunityMembers.select("userId")
      .where((member) =>
        and(
          member.status.eq("ACTIVE"),
          member.community.some((community) => community._type.neq("PRIVATE"))
        )
      )
      .distinct("userId")
      .all(),
  ]);
  return {
    communities: communities.count,
    members: members.length,
    posts: posts.count,
  };
}

export async function getJoinedCommunities(
  userId: string
): Promise<CommunityData[]> {
  const memberships = await prisma.orm.public.CommunityMembers.select("id")
    .include("community", (_community) => getCommunitySelect())
    .where((member) =>
      and(member.status.eq("ACTIVE"), member.userId.eq(userId))
    )
    .orderBy((member) => member.createdAt.desc())
    .all();
  return memberships.map((membership) => {
    if (!membership.community) {
      throw new Error(`Community membership ${membership.id} has no community`);
    }
    return mapCommunityData(membership.community);
  });
}

export interface CommunitySections {
  growing: CommunityData[];
  trending: CommunityData[];
}

export async function getTopCommunities(limit = 6): Promise<CommunityData[]> {
  const result = await queryCommunityRows({
    limit: Math.min(Math.max(limit, 1), 24),
    orderByMemberCount: true,
  });
  return result.communities;
}

export interface RecentCommunityVisit {
  community: CommunityData;
  visitedAt: Date;
}

export async function getCommunityAuraMap(
  communityIds: string[]
): Promise<Record<string, number>> {
  const ids = [...new Set(communityIds.filter(Boolean))];
  if (ids.length === 0) {
    return {};
  }
  const rows = await prisma.orm.public.Posts.where((post) =>
    post.communityId.in(ids)
  )
    .groupBy("communityId")
    .aggregate((aggregate) => ({ total: aggregate.sum("aura") }));
  const auras: Record<string, number> = Object.fromEntries(
    ids.map((id) => [id, 0])
  );
  for (const row of rows) {
    if (row.communityId) {
      auras[row.communityId] = row.total ?? 0;
    }
  }
  return auras;
}

export async function getCommunitySections({
  limit = 12,
  now = new Date(),
}: {
  limit?: number;
  now?: Date;
} = {}): Promise<CommunitySections> {
  const take = Math.min(Math.max(limit, 1), 24);
  const growingSince = new Date(
    now.getTime() - COMMUNITY_GROWING_WINDOW_DAYS * 86_400_000
  );
  const growingRows = await getCommunitySelect()
    .where((community) =>
      and(
        community._type.neq("PRIVATE"),
        community.createdAt.gte(toPrismaDateTime(growingSince)),
        community.communityMembers.some((member) => member.status.eq("ACTIVE"))
      )
    )
    .all();
  const growing = growingRows
    .map(mapCommunityData)
    .toSorted(compareCommunityActivity)
    .slice(0, take);
  const trendingResult = await queryCommunityRows({
    limit: Number.MAX_SAFE_INTEGER,
    orderByMemberCount: true,
  });
  const growingIds = new Set(growing.map((community) => community.id));
  return {
    growing,
    trending: trendingResult.communities
      .filter((community) => !growingIds.has(community.id))
      .slice(0, take),
  };
}

export async function getCommunityStats(
  communityId: string
): Promise<CommunityStats> {
  const since = new Date(
    Date.now() - COMMUNITY_ACTIVITY_WINDOW_DAYS * 86_400_000
  );
  const [postAura, members, weeklyVisitors] = await Promise.all([
    prisma.orm.public.Posts.where({ communityId }).aggregate((aggregate) => ({
      total: aggregate.sum("aura"),
    })),
    prisma.orm.public.CommunityMembers.where((member) =>
      and(member.communityId.eq(communityId), member.status.eq("ACTIVE"))
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
    prisma.orm.public.CommunityVisits.where((visit) =>
      and(
        visit.communityId.eq(communityId),
        visit.visitedAt.gte(toPrismaDateTime(since))
      )
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
  ]);
  return {
    communityAura: postAura.total ?? 0,
    members: members.count,
    weeklyVisitors: weeklyVisitors.count,
  };
}

export async function recordCommunityVisit(
  communityId: string,
  userId: string
): Promise<void> {
  const visitedAt = toPrismaDateTime(new Date());
  await prisma.orm.public.CommunityVisits.upsert({
    conflictOn: { communityId, userId },
    create: { communityId, userId, visitedAt },
    update: { visitedAt },
  });
}

export async function getManagedCommunities(
  userId: string
): Promise<CommunityData[]> {
  const memberships = await prisma.orm.public.CommunityMembers.select("id")
    .include("community", (_community) => getCommunitySelect())
    .where((member) =>
      and(
        member.userId.eq(userId),
        member.status.eq("ACTIVE"),
        member.role.in(["OWNER", "MODERATOR"])
      )
    )
    .orderBy((member) => member.createdAt.desc())
    .all();
  return memberships.map((membership) => {
    if (!membership.community) {
      throw new Error(`Community membership ${membership.id} has no community`);
    }
    return mapCommunityData(membership.community);
  });
}

export interface UserCommunityRole {
  community: {
    accentColor: string;
    avatarUrl: string | null;
    id: string;
    name: string;
    slug: string;
  };
  role: "MEMBER" | "MODERATOR" | "OWNER";
}

export async function getUserCommunityRoles(
  userId: string
): Promise<UserCommunityRole[]> {
  if (!userId) {
    return [];
  }
  const memberships = await prisma.orm.public.CommunityMembers.select("role")
    .include("community", (community) =>
      community.select("accentColor", "avatarUrl", "id", "name", "slug")
    )
    .where((member) =>
      and(
        member.userId.eq(userId),
        member.status.eq("ACTIVE"),
        member.role.in(["OWNER", "MODERATOR", "MEMBER"])
      )
    )
    .orderBy([
      (member) => member.role.asc(),
      (member) => member.createdAt.desc(),
    ])
    .all();
  return memberships.flatMap((membership) =>
    membership.community
      ? [
          {
            community: membership.community,
            role: membership.role as UserCommunityRole["role"],
          },
        ]
      : []
  );
}

export type CommunityFeedSort = "new" | "top";

export interface CommunityFeedOptions {
  communityId: string;
  cursor?: string;
  limit?: number;
  loggedInUserId: string;
  sort?: CommunityFeedSort;
}

export async function getCommunityFeedPage(
  options: CommunityFeedOptions
): Promise<{
  nextCursor: string | null;
  posts: ReturnType<typeof mapPostData>[];
}> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 20);
  const sort = options.sort ?? "new";
  const query = getPostDataQuery(prisma.orm, options.loggedInUserId).where(
    (post) =>
      and(post.communityId.eq(options.communityId), post.isGust.eq(false))
  );
  const orderedQuery =
    sort === "top"
      ? query.orderBy([(post) => post.aura.desc(), (post) => post.id.desc()])
      : query.orderBy([
          (post) => post.createdAt.desc(),
          (post) => post.id.desc(),
        ]);
  const pagedQuery = options.cursor
    ? orderedQuery.cursor({ id: options.cursor })
    : orderedQuery;
  const rows = await pagedQuery.limit(limit + 1).all();
  const posts = rows.map(mapPostData);
  const hasMore = posts.length > limit;
  return {
    nextCursor: hasMore ? (posts[limit - 1]?.id ?? null) : null,
    posts: posts.slice(0, limit),
  };
}

export async function getTopCommunitiesByAura(
  limit = 6
): Promise<CommunityData[]> {
  const take = Math.min(Math.max(limit, 1), 24);
  const ranked = await prisma.orm.public.Posts.where((post) =>
    post.communityId.isNotNull()
  )
    .groupBy("communityId")
    .aggregate((aggregate) => ({ total: aggregate.sum("aura") }));
  const ids = ranked
    .toSorted((left, right) => {
      const auraDifference = (right.total ?? 0) - (left.total ?? 0);
      return (
        auraDifference ||
        (left.communityId ?? "").localeCompare(right.communityId ?? "")
      );
    })
    .slice(0, take)
    .map((row) => row.communityId)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) {
    return [];
  }
  const rows = await getCommunitySelect()
    .where((community) =>
      and(community.id.in(ids), community._type.neq("PRIVATE"))
    )
    .all();
  const byId = new Map(rows.map((row) => [row.id, mapCommunityData(row)]));
  return ids
    .map((id) => byId.get(id))
    .filter((community): community is CommunityData => Boolean(community));
}

export interface ActiveCategory {
  count: number;
  key: string;
  label: string;
  topics: readonly string[];
}

export async function getMostActiveCategory(): Promise<ActiveCategory | null> {
  const categories = COMMUNITY_CATEGORIES.filter(
    (category) => category.key !== "all"
  );
  const communities = await prisma.orm.public.Communities.select("id", "topics")
    .where((community) => community._type.neq("PRIVATE"))
    .all();
  const communityIds = communities.map((community) => community.id);
  const posts = communityIds.length
    ? await prisma.orm.public.Posts.select("communityId")
        .where((post) => post.communityId.in(communityIds))
        .all()
    : [];
  const counts = categories.map((category) => {
    const matchingCommunityIds = new Set(
      communities
        .filter((community) => hasAnyTopic(community.topics, category.topics))
        .map((community) => community.id)
    );
    let count = 0;
    for (const post of posts) {
      if (post.communityId && matchingCommunityIds.has(post.communityId)) {
        count += 1;
      }
    }
    return count;
  });

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
  return best
    ? {
        count: counts[bestIndex] ?? 0,
        key: best.key,
        label: best.label,
        topics: [...best.topics],
      }
    : null;
}

export async function getRecentlyVisitedCommunities(
  userId: string,
  limit = 6
): Promise<RecentCommunityVisit[]> {
  if (!userId) {
    return [];
  }
  const visits = await prisma.orm.public.CommunityVisits.select(
    "id",
    "visitedAt"
  )
    .include("community", (_community) => getCommunitySelect())
    .where((visit) =>
      and(
        visit.userId.eq(userId),
        visit.community.some((community) => community._type.neq("PRIVATE"))
      )
    )
    .orderBy((visit) => visit.visitedAt.desc())
    .limit(Math.min(Math.max(limit, 1), 24))
    .all();
  return visits.map((visit) => {
    if (!visit.community) {
      throw new Error(`Community visit ${visit.id} has no community`);
    }
    return {
      community: mapCommunityData(visit.community),
      visitedAt: fromPrismaDateTime(visit.visitedAt),
    };
  });
}

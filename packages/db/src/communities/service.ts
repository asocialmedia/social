// Community domain service. Owns creation, membership, discovery listing, and
// the aggregated stats shown on the community sidebar. Every function here is
// server-only and expects the caller to have already authenticated; the
// authorization checks that depend on the acting user take an explicit
// `actorId` so the rules stay testable without a session object.

import { createLogger } from "@asm/logger";

import type { Prisma } from "../../prisma/generated/prisma/client";
import {
  COMMUNITY_JOIN_AURA,
  COMMUNITY_JOIN_DAILY_AURA_CAP,
  COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS,
  COMMUNITY_JOIN_OWNER_AURA,
} from "../aura/config";
import { applyFlatAward } from "../aura/ledger";
import { computeStandingForUser, getCommunityStanding } from "../aura/standing";
import { getPostDataInclude } from "../client";
import type { PostData } from "../client";
import prisma from "../prisma";
import { ensureSearchIndexes } from "../search";
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
import { normalizeCommunitySlug, isValidCommunitySlug } from "./slug";

const logger = createLogger({ serviceName: "communities" });

// The membership role, shared by every read/write signature here so the wizard,
// the members list and the profile can all agree on one union. Named
// `CommunityRoleValue` rather than `CommunityRole` because the generated Prisma
// enum already owns that name on the package barrel.
export type CommunityRoleValue =
  | "MEMBER"
  | "MODERATOR"
  | "OWNER"
  | "PARTICIPANT";

export interface CommunityMembership {
  role: CommunityRoleValue;
  status: "ACTIVE" | "PENDING";
}

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
  // The community's own output: the sum of its posts' raw aura.
  communityAura: number;
  members: number;
  // Distinct viewers over the rolling activity window.
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

// Prisma reports a violated unique index as P2002. Read structurally rather
// than via instanceof so the check works across generated-client copies and
// test doubles.
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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

// Pays the one-time join bonus for a membership that has just become ACTIVE.
//
// Guards, in order of importance:
//  1. The CommunityJoinBonus unique constraint on (communityId, userId) is the
//     durable one-time marker. It is written the first time the pair activates
//     and never deleted, so leaving and rejoining cannot pay twice - unlike the
//     membership row, which leave() removes.
//  2. A rolling daily ceiling on joiner aura bounds a sweep of the directory.
//     Membership still succeeds past the ceiling; only the payout stops, so the
//     cap never blocks a genuine join.
//  3. Owners are never paid for joining their own community.
//
// Must run inside the caller's transaction so the marker and the balance moves
// commit together.
async function grantCommunityJoinBonus(
  tx: Prisma.TransactionClient,
  input: { communityId: string; ownerId: string; userId: string }
): Promise<void> {
  if (input.userId === input.ownerId) {
    return;
  }

  const now = new Date();

  // Sybil gate: a freshly minted account joins freely but is not paid, so a
  // farm cannot convert throwaway accounts into aura without aging each one.
  const joiner = await tx.user.findUnique({
    select: { createdAt: true },
    where: { id: input.userId },
  });
  const accountAgeDays =
    (now.getTime() - (joiner?.createdAt.getTime() ?? now.getTime())) /
    86_400_000;
  if (accountAgeDays < COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS) {
    return;
  }

  // Serialize the cap check and the payout on the joiner's own row. Without
  // this lock, parallel joins into DIFFERENT communities all read the same
  // running total, each conclude the gift fits inside the remaining daily
  // budget, and together overshoot COMMUNITY_JOIN_DAILY_AURA_CAP by up to
  // (concurrency - 1) awards. The lock is held to commit, so the next join
  // sees this one's marker row in its aggregate.
  //
  // FOR NO KEY UPDATE, not FOR UPDATE: the membership upsert earlier in this
  // transaction already holds a FK KEY SHARE on this user row, and FOR UPDATE
  // conflicts with KEY SHARE. Two concurrent joins would then each hold their
  // own KEY SHARE and each wait for the other's FOR UPDATE - a deadlock. NO KEY
  // UPDATE is compatible with KEY SHARE, still mutually exclusive with itself,
  // and is the correct mode for an aura increment that does not touch the id.
  await tx.$queryRaw`
    SELECT "id" FROM "users" WHERE "id" = ${input.userId} FOR NO KEY UPDATE
  `;

  const earnedToday = await tx.communityJoinBonus.aggregate({
    _sum: { joinerAura: true },
    where: { createdAt: { gte: startOfUtcDay(now) }, userId: input.userId },
  });
  const paidToday = earnedToday._sum.joinerAura ?? 0;
  // The gift must FIT inside the remaining daily budget, not merely start
  // below it: checking `paidToday < cap` alone would let the final join
  // overshoot the ceiling by up to one full award. A partial gift is not paid
  // either - the award is all-or-nothing, so the ceiling is never exceeded.
  const withinCap =
    paidToday + COMMUNITY_JOIN_AURA <= COMMUNITY_JOIN_DAILY_AURA_CAP;

  // The marker is written even when the cap zeroes the payout: the pair has
  // been considered, so a later leave/rejoin cannot revisit it. A capped join
  // simply forfeits that community's gift.
  const joinerAura = withinCap ? COMMUNITY_JOIN_AURA : 0;
  const ownerAura = withinCap ? COMMUNITY_JOIN_OWNER_AURA : 0;

  // `createMany` with skipDuplicates, NOT create + catch(P2002): in Postgres a
  // failed statement aborts the surrounding transaction, and a later COMMIT on
  // an aborted transaction silently ROLLS BACK. Catching the unique violation in
  // JS would therefore leave the caller's membership upsert undone while this
  // function reported success. skipDuplicates makes the insert a no-op on
  // conflict, so the transaction stays healthy either way.
  const inserted = await tx.communityJoinBonus.createMany({
    data: [
      {
        communityId: input.communityId,
        joinerAura,
        ownerAura,
        userId: input.userId,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) {
    // Already paid or already considered for this community.
    return;
  }

  if (joinerAura > 0) {
    // Not subject to the daily income cap: it is a one-time welcome gift
    // already bounded by the join-specific ceiling above, and the generic
    // 120/day cap would shred it to pocket change.
    await applyFlatAward(tx, {
      actorId: input.ownerId,
      baseAmount: joinerAura,
      now,
      recipientId: input.userId,
      subjectToDailyCap: false,
      type: "COMMUNITY_JOIN",
    });
  }

  if (ownerAura > 0) {
    await applyFlatAward(tx, {
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
  // How many communities the account already owns.
  owned: number;
  // The account's raw aura balance, for display.
  aura: number;
  // The founding credential. Gates creation; see getCommunityStanding.
  standing: number;
  // Total attention-milestone aura earned (views, shares).
  reachAura: number;
  // How much of that reach counted toward standing (capped).
  reachCounted: number;
  // Standing required to found the next community (null once capped).
  nextRequirement: number | null;
  // Aura paid to the founder for founding the next community.
  nextBonus: number;
  // False when either the standing gate or the ownership cap blocks creation.
  canCreate: boolean;
  // True when the ownership cap has been reached (distinct from standing).
  maxed: boolean;
}

// Server-side creation quota. Reads the account's standing (the founding
// credential) and owned-community count so the wizard can show the gate before
// the reader invests time in the flow; the same rule is re-checked atomically at
// write time in createCommunity, so this can never be trusted as the
// enforcement point.
export async function getCommunityCreationQuota(
  userId: string
): Promise<CommunityCreationQuota> {
  const [standing, owned] = await Promise.all([
    getCommunityStanding(userId),
    prisma.community.count({ where: { ownerId: userId } }),
  ]);
  const nextRequirement = communityCreationAuraRequirement(owned);
  const maxed = owned >= COMMUNITY_MAX_OWNED;
  return {
    aura: standing.aura,
    canCreate:
      !maxed &&
      nextRequirement !== null &&
      standing.standing >= nextRequirement,
    maxed,
    nextBonus: communityFoundingBonus(owned),
    nextRequirement,
    owned,
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
    // Serialize concurrent creations by the same account on its own user row.
    // Without the row lock, two in-flight requests both read "you own none of
    // your four communities" and both pass the gate, letting one account found
    // several communities at once. The lock makes the count-then-create
    // sequence effectively atomic per user.
    await tx.$queryRaw`
      SELECT "id" FROM "users" WHERE "id" = ${input.ownerId} FOR UPDATE
    `;

    const owned = await tx.community.count({
      where: { ownerId: input.ownerId },
    });
    const requirement = communityCreationAuraRequirement(owned);
    if (requirement === null) {
      throw new CommunityError(
        "LIMIT_REACHED",
        `You've reached the limit of ${COMMUNITY_MAX_OWNED} communities`
      );
    }

    // Gate on standing (the credential), not the raw aura balance, so one
    // viral post cannot clear a permanent bar. Read inside the locked
    // transaction so it cannot race a concurrent award or creation.
    const standing = await computeStandingForUser(tx, input.ownerId);
    if (standing.standing < requirement) {
      throw new CommunityError(
        "AURA_TOO_LOW",
        `Founding this community needs ${requirement} standing. You have ${standing.standing}.`
      );
    }

    let created: CommunityData;
    try {
      created = await tx.community.create({
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
    } catch (error) {
      // The pre-check above reads without a lock on the slug, so two accounts
      // can still race to the same address; the unique constraint is the real
      // guard. Map the collision to the domain error the wizard understands.
      if (isUniqueConstraintError(error)) {
        throw new CommunityError(
          "SLUG_TAKEN",
          "That community address is taken"
        );
      }
      throw error;
    }

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

    // Escalating founding bonus. Deliberately NOT subject to the daily income
    // cap: the action is already gated hard (standing + the 10-community cap +
    // rate limits), so it cannot be farmed, and the 120/day cap would shred a
    // 10,000 award down to pocket change. The award is excluded from standing
    // (STANDING_EXCLUDED_TYPES) so it cannot fund the next bar.
    await applyFlatAward(tx, {
      actorId: input.ownerId,
      baseAmount: communityFoundingBonus(owned),
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
): Promise<CommunityMembership | null> {
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

// The single view-access rule for community contents. PUBLIC and RESTRICTED
// communities are world-readable; PRIVATE promises "only approved users can
// view", so it is readable only by a viewer holding an ACTIVE membership. A
// guest, and a PENDING applicant, are both denied. Reads that resolve a
// community by slug or id must gate on this before returning its posts,
// metadata, roster, or media, otherwise knowing the slug would defeat the
// privacy setting.
//
// Takes the already-resolved community so a caller that has fetched it does not
// pay for a second lookup; `type` is all the rule needs.
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

// The same rule when only the community id is known (e.g. the avatar/banner
// media proxies). Returns false rather than throwing for a missing community,
// so callers can answer 404 without a second existence check.
export async function canViewCommunityById(
  communityId: string,
  userId: string
): Promise<boolean> {
  const community = await prisma.community.findUnique({
    select: { id: true, type: true },
    where: { id: communityId },
  });
  if (!community) {
    return false;
  }
  return await canViewCommunity(community, userId);
}

// Re-exported so existing consumers keep importing it from the
// communities service; the implementation lives in ./visibility so low-level
// readers can use it without cycle risk.
export { communityVisibilityWhere } from "./visibility";

// Public communities join instantly. Restricted and Private communities open a
// PENDING request that an owner/moderator approves; the creator is always
// ACTIVE. Kept here so both the API route and any future surface share it.
export async function joinCommunity(
  communityId: string,
  userId: string
): Promise<{ status: "ACTIVE" | "PENDING" }> {
  const community = await prisma.community.findUnique({
    select: { id: true, ownerId: true, type: true },
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
  await prisma.$transaction(async (tx) => {
    await tx.communityMember.upsert({
      // Joining grants PARTICIPANT, which carries no badge. A promoted role
      // does not survive a leave: leaveCommunity deletes the membership row, so
      // a returning member rejoins as a participant and must be re-promoted.
      create: { communityId, role: "PARTICIPANT", status, userId },
      update: { status },
      where: { communityId_userId: { communityId, userId } },
    });

    // Restricted/private communities pay only once the join is ACTIVE, which
    // happens on approval (approveMember), not here.
    if (status === "ACTIVE") {
      await grantCommunityJoinBonus(tx, {
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
    prisma.communityMember.findUnique({
      select: { role: true },
      where: { communityId_userId: { communityId, userId } },
    }),
    prisma.community.findUnique({
      select: { type: true },
      where: { id: communityId },
    }),
  ]);
  // The owner cannot abandon a community; ownership transfer is out of scope.
  if (membership?.role === "OWNER") {
    throw new CommunityError(
      "FORBIDDEN",
      "The owner cannot leave their community"
    );
  }

  await prisma.$transaction(async (tx) => {
    // Serialize with the notification fan-out: without this lock a fan-out that
    // read the subscriber set just before the leave could still create a
    // notification for the departing member after their access was revoked.
    await lockCommunityNotifications(tx, communityId);

    await tx.communityMember.deleteMany({ where: { communityId, userId } });

    // Leaving a PRIVATE community revokes read access, so the subscription and
    // any already-delivered post notifications would now expose content the
    // member can no longer see. Clearing both on the way out closes that, and
    // the fan-out's own readability filter covers any row missed here.
    if (community?.type === "PRIVATE") {
      await tx.communitySubscription.deleteMany({
        where: { communityId, userId },
      });
      await tx.notification.deleteMany({
        where: { communityId, recipientId: userId, type: "COMMUNITY_POST" },
      });
    }
  });

  logger.info({ communityId, userId }, "community leave");
}

// --- Community subscriptions -------------------------------------------------
//
// Subscribing is independent of membership: anyone who can read a community
// (public, or a private one they belong to) may follow its posts. A
// subscription drives two things - the notification fan-out on new posts, and
// the reader's Latest feed - so the write path stays a single small row.

// How many subscribers one post will notify in a single fan-out. A hard cap
// keeps a megaphone community from turning one publish into an unbounded write
// burst; the notification is a convenience, and the Latest feed (which reads
// subscriptions live) remains complete regardless.
const MAX_COMMUNITY_NOTIFY_FANOUT = 5000;

export async function subscribeToCommunity(
  communityId: string,
  userId: string
): Promise<void> {
  // A private community's existence is members-only, so subscribing to one the
  // viewer cannot read would leak it. Everything else is open to follow.
  const community = await prisma.community.findUnique({
    select: { type: true },
    where: { id: communityId },
  });
  if (!community) {
    throw new CommunityError("NOT_FOUND", "Community not found");
  }
  if (community.type === "PRIVATE") {
    const membership = await prisma.communityMember.findUnique({
      select: { status: true },
      where: { communityId_userId: { communityId, userId } },
    });
    if (membership?.status !== "ACTIVE") {
      throw new CommunityError("NOT_FOUND", "Community not found");
    }
  }

  await prisma.communitySubscription.upsert({
    create: { communityId, userId },
    update: {},
    where: { communityId_userId: { communityId, userId } },
  });
  logger.info({ communityId, userId }, "community subscribe");
}

export async function unsubscribeFromCommunity(
  communityId: string,
  userId: string
): Promise<void> {
  await prisma.communitySubscription.deleteMany({
    where: { communityId, userId },
  });
  logger.info({ communityId, userId }, "community unsubscribe");
}

export async function isSubscribedToCommunity(
  communityId: string,
  userId: string
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const subscription = await prisma.communitySubscription.findUnique({
    select: { id: true },
    where: { communityId_userId: { communityId, userId } },
  });
  return Boolean(subscription);
}

// Serializes every community-notification mutation for one community for the
// rest of a transaction. The fan-out and leaveCommunity both take it, so a
// leave cannot interleave with a fan-out and leave a departing member with a
// notification (or vice versa). A transaction-scoped advisory lock is used
// rather than SELECT ... FOR UPDATE on the community row: the fan-out runs
// AFTER the post insert, which already holds FOR KEY SHARE on the community via
// its foreign key, and upgrading that to FOR UPDATE would deadlock against a
// concurrent publisher. A bare `SELECT pg_advisory_xact_lock(...)` returns
// `void`, which Prisma's raw deserializer rejects; the outer select yields int.
async function lockCommunityNotifications(
  tx: Prisma.TransactionClient,
  communityId: string
): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS acquired FROM (SELECT pg_advisory_xact_lock(hashtext('community-notify'), hashtext(${communityId}))) AS lock`;
}

// The viewers a new post in `communityId` should notify: its subscribers minus
// the author, minus anyone who cannot currently READ the community.
//
// The readability pass is load-bearing, not defensive. A subscription is
// independent of membership, so a member of a PRIVATE community who subscribes
// and then leaves keeps their row - without this filter the fan-out would push
// the community's new posts, and their content, to a former member.
//
// For a PRIVATE community the membership condition is applied INSIDE the query,
// before the fan-out cap: filtering after `take` would let stale subscriptions
// (departed members) consume the cap and crowd out legitimate active members.
// Non-private communities are readable by everyone, so they skip the filter.
async function selectNotifiableSubscriberIds(
  client: Prisma.TransactionClient,
  communityId: string,
  excludeUserId: string
): Promise<string[]> {
  const community = await client.community.findUnique({
    select: { type: true },
    where: { id: communityId },
  });

  const subscriptions = await client.communitySubscription.findMany({
    select: { userId: true },
    take: MAX_COMMUNITY_NOTIFY_FANOUT,
    where: {
      communityId,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      ...(community?.type === "PRIVATE"
        ? {
            user: {
              communityMemberships: {
                some: { communityId, status: "ACTIVE" as const },
              },
            },
          }
        : {}),
    },
  });
  return subscriptions.map((sub) => sub.userId);
}

// The viewers to notify about a new post in `communityId`, excluding the
// author (who already knows) and anyone who can no longer read it, capped for
// safety. Read-only counterpart of the fan-out, used for diagnostics and tests.
export async function getCommunitySubscriberIds(
  communityId: string,
  excludeUserId: string
): Promise<string[]> {
  return await selectNotifiableSubscriberIds(
    prisma,
    communityId,
    excludeUserId
  );
}

// Batched fan-out for a new community post, run inside the publisher's
// transaction so a rollback leaves no notification behind. One rolling row per
// (recipient, community) is folded in place: an unread COMMUNITY_POST row
// already waiting is incremented and re-pointed at the newest post, and only
// recipients without one get a fresh row. Returns the recipients who received a
// NEW row (with the row's id, so the caller can enqueue the unread-counter bump
// and push delivery for exactly those); an in-place increment on an
// already-unread row does not change the count.
export async function notifyCommunitySubscribers(
  tx: Prisma.TransactionClient,
  input: { authorId: string; communityId: string; postId: string }
): Promise<{ id: string; recipientId: string }[]> {
  // Serialize fan-outs per community for the rest of this transaction. Two
  // posts published at once would otherwise both read "no unread row" and each
  // insert one, breaking the one-row-per-reader batching contract and
  // double-incrementing the unread badge. Same lock leaveCommunity takes, so a
  // leave cannot interleave with this fan-out.
  await lockCommunityNotifications(tx, input.communityId);

  const recipientIds = await selectNotifiableSubscriberIds(
    tx,
    input.communityId,
    input.authorId
  );
  if (recipientIds.length === 0) {
    return [];
  }

  const existing = await tx.notification.findMany({
    select: { recipientId: true },
    where: {
      communityId: input.communityId,
      read: false,
      recipientId: { in: recipientIds },
      type: "COMMUNITY_POST",
    },
  });
  const { fold, fresh } = planCommunityNotification(
    recipientIds,
    existing.map((notification) => notification.recipientId)
  );

  if (fold.length > 0) {
    await tx.notification.updateMany({
      data: {
        count: { increment: 1 },
        createdAt: new Date(),
        postId: input.postId,
      },
      where: {
        communityId: input.communityId,
        read: false,
        recipientId: { in: fold },
        type: "COMMUNITY_POST",
      },
    });
  }

  if (fresh.length === 0) {
    return [];
  }

  return await tx.notification.createManyAndReturn({
    data: fresh.map((recipientId) => ({
      communityId: input.communityId,
      count: 1,
      issuerId: input.authorId,
      postId: input.postId,
      recipientId,
      type: "COMMUNITY_POST" as const,
    })),
    select: { id: true, recipientId: true },
  });
}

// The communities the viewer follows AND may currently read. A subscription is
// independent of membership, so a reader who subscribed to a private community
// and later left would still hold the row - filtering by the readability rule
// here keeps a private community's posts out of the Latest feed once access is
// gone. Used by the Latest feed to pull subscribed posts into the timeline.
export async function getSubscribedCommunityIds(
  userId: string
): Promise<string[]> {
  if (!userId) {
    return [];
  }
  const subscriptions = await prisma.communitySubscription.findMany({
    select: { communityId: true },
    where: {
      community: {
        OR: [
          { type: { not: "PRIVATE" } },
          { members: { some: { status: "ACTIVE", userId } } },
        ],
      },
      userId,
    },
  });
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

  const community = await prisma.community.findUnique({
    select: { ownerId: true },
    where: { id: communityId },
  });
  if (!community) {
    throw new CommunityError("NOT_FOUND", "Community not found");
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.communityMember.updateMany({
      data: { status: "ACTIVE" },
      where: { communityId, status: "PENDING", userId: targetUserId },
    });
    // Pay the join bonus only when a PENDING request actually flipped to
    // ACTIVE; a re-approval of an already-active member must not pay again.
    // The CommunityJoinBonus marker is the second guard either way.
    if (updated.count > 0) {
      await grantCommunityJoinBonus(tx, {
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

// Assignable roles: OWNER is never set through this path (the founder holds it
// and ownership transfer is out of scope), so the actor can only move someone
// between participant / member / moderator.
export type AssignableCommunityRole = "MEMBER" | "MODERATOR" | "PARTICIPANT";

const ASSIGNABLE_ROLES = new Set<AssignableCommunityRole>([
  "MEMBER",
  "MODERATOR",
  "PARTICIPANT",
]);

// Changes a member's role. Two actors may do this, with different reach:
//  - the OWNER may set any assignable role, including moderator;
//  - a MODERATOR may only move people between PARTICIPANT and MEMBER, so a mod
//    cannot mint peers or demote them.
// The owner row itself is untouchable through this path, and moderator
// promotions are capped at COMMUNITY_MAX_MODERATORS. Runs in a transaction so
// the cap check cannot be raced into a sixth moderator.
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
    prisma.community.findUnique({
      select: { ownerId: true },
      where: { id: communityId },
    }),
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

  // A moderator may only promote/demote between participant and member.
  if (!isOwner && role === "MODERATOR") {
    throw new CommunityError(
      "FORBIDDEN",
      "Only the owner can appoint moderators"
    );
  }

  if (!target) {
    throw new CommunityError("NOT_FOUND", "That person is not a member");
  }
  // The owner's role is fixed; ownership transfer is out of scope.
  if (target.role === "OWNER" || targetUserId === community.ownerId) {
    throw new CommunityError("FORBIDDEN", "The owner's role cannot be changed");
  }

  await prisma.$transaction(async (tx) => {
    // Serialize role changes on the community row. Counting moderators and then
    // promoting is a read-then-write race: two concurrent promotions can both
    // read the pre-promotion count, both pass the cap, and commit as the
    // (N+1)th and (N+2)th moderator. The row lock is held to commit, so each
    // promoter sees every promotion that committed before it.
    await tx.$queryRaw`
      SELECT "id" FROM "communities" WHERE "id" = ${communityId} FOR UPDATE
    `;

    // Re-read the target under the lock: the pre-transaction `target.role` can
    // be stale by the time we get here, and a promotion of this same person
    // already committed must not be counted as a fresh slot.
    const currentTarget = await tx.communityMember.findUnique({
      select: { role: true },
      where: { communityId_userId: { communityId, userId: targetUserId } },
    });
    if (!currentTarget) {
      throw new CommunityError("NOT_FOUND", "That person is not a member");
    }

    if (role === "MODERATOR" && currentTarget.role !== "MODERATOR") {
      const moderatorCount = await tx.communityMember.count({
        where: { communityId, role: "MODERATOR", status: "ACTIVE" },
      });
      if (moderatorCount >= COMMUNITY_MAX_MODERATORS) {
        throw new CommunityError(
          "MOD_LIMIT_REACHED",
          `A community can have at most ${COMMUNITY_MAX_MODERATORS} moderators`
        );
      }
    }

    await tx.communityMember.updateMany({
      data: { role },
      where: { communityId, userId: targetUserId },
    });
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
  // Warm the community trigram indexes before the ILIKE scan; a no-op once
  // they exist. Without them the name/slug/description `contains` degrades to a
  // sequential scan of the whole directory.
  await ensureSearchIndexes();

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
//
// The member figure is a DISTINCT count in SQL, not a `findMany(distinct)`:
// distinct users across the public set is O(all memberships) and materializing
// every userId in the app (as the previous version did) would ship hundreds of
// thousands of ids over the wire into memory on every cache miss. One indexed
// COUNT(DISTINCT) keeps the work in Postgres and returns a single row.
export async function getCommunityDiscoveryStats(): Promise<CommunityDiscoveryStats> {
  const publicCommunity: Prisma.CommunityWhereInput = {
    type: { not: "PRIVATE" },
  };
  const [communities, posts, memberRows] = await Promise.all([
    prisma.community.count({ where: publicCommunity }),
    prisma.post.count({ where: { community: publicCommunity } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT cm."userId")::bigint AS count
      FROM "community_members" cm
      JOIN "communities" c ON c."id" = cm."communityId"
      WHERE cm."status" = 'ACTIVE'::"CommunityMemberStatus"
        AND c."type" <> 'PRIVATE'::"CommunityType"
    `,
  ]);

  return {
    communities,
    members: Number(memberRows[0]?.count ?? 0),
    posts,
  };
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

// Aggregated sidebar stats: the community's own output, how many people belong,
// and how many distinct viewers it drew inside the rolling activity window.
// Visitors come from CommunityVisit over that window rather than a
// denormalized counter, so the number stays honest as the window slides.
export async function getCommunityStats(
  communityId: string
): Promise<CommunityStats> {
  const since = new Date(
    Date.now() - COMMUNITY_ACTIVITY_WINDOW_DAYS * 86_400_000
  );

  // Three indexed reads, all O(index range for this community):
  //  - the aura sum rides the (communityId, aura) covering index;
  //  - the member count rides (communityId, status);
  //  - the visitor count rides (communityId, visitedAt) inside the window.
  //
  // Two aggregates were dropped here: `contributors` (a correlated EXISTS per
  // member, O(members)) and `memberAura` (a sum over every active member,
  // O(members)). Neither had a reader left once the sidebar dropped them, so
  // they were pure cost on every cache miss.
  const [postAura, members, weeklyVisitors] = await Promise.all([
    prisma.post.aggregate({
      _sum: { aura: true },
      where: { communityId },
    }),
    prisma.communityMember.count({
      where: { communityId, status: "ACTIVE" },
    }),
    prisma.communityVisit.count({
      where: { communityId, visitedAt: { gte: since } },
    }),
  ]);

  return {
    communityAura: postAura._sum.aura ?? 0,
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

// The badged community roles a user holds, for the profile's "outside" surface.
// Only roles that carry a badge are returned (PARTICIPANT is the default state,
// not an achievement), ordered owner-first so the most senior role leads.
export async function getUserCommunityRoles(
  userId: string
): Promise<UserCommunityRole[]> {
  if (!userId) {
    return [];
  }
  const memberships = await prisma.communityMember.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    select: {
      community: {
        select: {
          accentColor: true,
          avatarUrl: true,
          id: true,
          name: true,
          slug: true,
        },
      },
      role: true,
    },
    where: {
      role: { in: ["OWNER", "MODERATOR", "MEMBER"] },
      status: "ACTIVE",
      userId,
    },
  });
  return memberships as UserCommunityRole[];
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

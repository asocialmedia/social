import { and } from "@prisma/orm-postgres/orm-client";

import prisma, { toPrismaDateTime } from "../prisma";
import { SYSTEM_MODERATION_USER_ID } from "./reserved-usernames";

export const BADGE_AUTHOR = "author";
export const BADGE_DEV = "dev";
export const BADGE_EARLY = "early";
export const BADGE_SHITPOSTER = "shitposter";
export const BADGE_TRENDING = "trending";

export const BADGES = [
  BADGE_AUTHOR,
  BADGE_DEV,
  BADGE_EARLY,
  BADGE_SHITPOSTER,
  BADGE_TRENDING,
] as const;

export type Badge = (typeof BADGES)[number];
export const SHITPOSTER_THRESHOLD = 5;
export const SHITPOSTER_WINDOW_MS = 30 * 60 * 1000;

const BADGE_PRECEDENCE: Record<string, number> = {
  author: 0,
  dev: 1,
  early: 3,
  shitposter: 2,
  trending: 4,
};

export function getUserBadges(user: {
  badge?: string | null;
  badges?: readonly string[] | null;
}): string[] {
  const merged = new Set<string>();
  for (const value of [
    ...(user.badges ?? []),
    ...(user.badge ? [user.badge] : []),
  ]) {
    if (value) {
      merged.add(value.toLowerCase());
    }
  }
  return [...merged].toSorted(
    (a, b) => (BADGE_PRECEDENCE[a] ?? 99) - (BADGE_PRECEDENCE[b] ?? 99)
  );
}

export class BadgeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeLimitError";
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "23505";
}

export function canonicalBadge(value: string): Badge | null {
  const normalized = value.trim().toLowerCase();
  return BADGES.includes(normalized as Badge) ? (normalized as Badge) : null;
}

async function assertAuthorSlot(userId: string) {
  const holder = await prisma.orm.public.Users.select("id")
    .where((user) => and(user.id.neq(userId), user.badge.eq(BADGE_AUTHOR)))
    .first();
  if (holder) {
    throw new BadgeLimitError("Only one author is allowed for the app.");
  }
}

export async function grantBadge(
  userId: string,
  badge: string
): Promise<boolean> {
  const canonical = canonicalBadge(badge);
  if (!canonical) {
    return false;
  }

  if (canonical === BADGE_AUTHOR) {
    await assertAuthorSlot(userId);
    const holder = await prisma.orm.public.Users.select("badge", "badges")
      .where({ id: userId })
      .first();
    if (holder && getUserBadges(holder).includes(BADGE_AUTHOR)) {
      return false;
    }
    try {
      await prisma.orm.public.Users.where({ id: userId }).update({
        badge: BADGE_AUTHOR,
        updatedAt: toPrismaDateTime(new Date()),
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new BadgeLimitError("Only one author is allowed for the app.");
      }
      throw error;
    }
  }

  const user = await prisma.orm.public.Users.select("badge", "badges")
    .where({ id: userId })
    .first();
  if (!user) {
    return false;
  }

  const current = getUserBadges(user);
  if (current.includes(canonical)) {
    return false;
  }

  await prisma.orm.public.Users.where({ id: userId }).update({
    badges: [...current, canonical],
    updatedAt: toPrismaDateTime(new Date()),
  });
  return true;
}

export async function revokeBadge(
  userId: string,
  badge: string
): Promise<boolean> {
  const canonical = canonicalBadge(badge);
  if (!canonical) {
    return false;
  }

  if (canonical === BADGE_AUTHOR) {
    throw new BadgeLimitError("The author badge cannot be revoked.");
  }

  const user = await prisma.orm.public.Users.select("badge", "badges")
    .where({ id: userId })
    .first();
  if (!user) {
    return false;
  }

  const next = getUserBadges(user).filter((value) => value !== canonical);
  if (next.length === getUserBadges(user).length) {
    return false;
  }

  await prisma.orm.public.Users.where({ id: userId }).update({
    badge: user.badge === canonical ? null : user.badge,
    badges: next,
    updatedAt: toPrismaDateTime(new Date()),
  });
  return true;
}

export async function grantShitposterBadgeIfQualified(
  userId: string
): Promise<boolean> {
  const user = await prisma.orm.public.Users.select("badge", "badges")
    .where({ id: userId })
    .first();
  if (!user || getUserBadges(user).includes(BADGE_SHITPOSTER)) {
    return false;
  }

  const recentPosts = await prisma.orm.public.Posts.where((post) =>
    and(
      post.createdAt.gte(
        toPrismaDateTime(new Date(Date.now() - SHITPOSTER_WINDOW_MS))
      ),
      post.rootPostId.isNull(),
      post.userId.eq(userId)
    )
  ).aggregate((aggregate) => ({ count: aggregate.count() }));

  if (recentPosts.count < SHITPOSTER_THRESHOLD) {
    return false;
  }

  return grantBadge(userId, BADGE_SHITPOSTER);
}

export const EARLY_AURA_THRESHOLD = 5000;
export const EARLY_DEADLINE = new Date("2026-12-31T23:59:59.999Z");

export function isEarlyBadgeWindowOpen(now: Date = new Date()): boolean {
  return now.getTime() < EARLY_DEADLINE.getTime();
}

export async function grantEarlyBadgeIfQualified(
  userId: string,
  now: Date = new Date()
): Promise<boolean> {
  if (!isEarlyBadgeWindowOpen(now)) {
    return false;
  }
  const user = await prisma.orm.public.Users.select("aura")
    .where({ id: userId })
    .first();
  if (!user || user.aura < EARLY_AURA_THRESHOLD) {
    return false;
  }
  return grantBadge(userId, BADGE_EARLY);
}

export function sweepEarlyBadges(
  now: Date = new Date(),
  batchSize = 200
): Promise<number> {
  if (!isEarlyBadgeWindowOpen(now)) {
    return Promise.resolve(0);
  }

  async function sweep(
    cursor: string | undefined,
    granted: number
  ): Promise<number> {
    const candidates = await prisma.orm.public.Users.select(
      "badge",
      "badges",
      "id"
    )
      .where((user) =>
        and(user.aura.gte(EARLY_AURA_THRESHOLD), user.id.gt(cursor ?? ""))
      )
      .orderBy((user) => user.id.asc())
      .limit(batchSize)
      .all();
    const batch = candidates.filter(
      (user) => !getUserBadges(user).includes(BADGE_EARLY)
    );

    if (candidates.length === 0) {
      return granted;
    }

    const results = await Promise.all(
      batch.map((user) => grantBadge(user.id, BADGE_EARLY))
    );
    const nextGranted = granted + results.filter(Boolean).length;

    if (candidates.length < batchSize) {
      return nextGranted;
    }
    const nextCursor = candidates.at(-1)?.id;
    return nextCursor ? sweep(nextCursor, nextGranted) : nextGranted;
  }

  return sweep(undefined, 0);
}

export const TRENDING_BADGE_SIZE = 6;

export async function getTrendingUserIds(
  limit: number = TRENDING_BADGE_SIZE
): Promise<string[]> {
  const boundedLimit = Math.max(1, limit);
  const users = await prisma.orm.public.Users.select("aura", "id")
    .include("followsFollows", (follows) => follows.count())
    .where((user) => user.id.neq(SYSTEM_MODERATION_USER_ID))
    .all();
  return users
    .toSorted((left, right) =>
      right.followsFollows === left.followsFollows
        ? right.aura - left.aura || left.id.localeCompare(right.id)
        : right.followsFollows - left.followsFollows
    )
    .slice(0, boundedLimit)
    .map((user) => user.id);
}

export interface TrendingBadgeSyncResult {
  granted: number;
  revoked: number;
}

export async function syncTrendingBadges(
  currentUserIds: string[]
): Promise<TrendingBadgeSyncResult> {
  const current = new Set(currentUserIds.filter(Boolean));
  const holders = await prisma.orm.public.Users.select(
    "badge",
    "badges",
    "id"
  ).all();
  const holderIds = new Set(
    holders
      .filter((holder) => getUserBadges(holder).includes(BADGE_TRENDING))
      .map((holder) => holder.id)
  );
  const toGrant = [...current].filter((id) => !holderIds.has(id));
  const toRevoke = [...holderIds].filter((id) => !current.has(id));

  const [grantedResults, revokedResults] = await Promise.all([
    Promise.all(toGrant.map((id) => grantBadge(id, BADGE_TRENDING))),
    Promise.all(toRevoke.map((id) => revokeBadge(id, BADGE_TRENDING))),
  ]);

  return {
    granted: grantedResults.filter(Boolean).length,
    revoked: revokedResults.filter(Boolean).length,
  };
}

import prisma from "../prisma";
import { SYSTEM_MODERATION_USER_ID } from "./reserved-usernames";

// Badge values stored on User.badges. "author" is special: the app allows at
// most one holder, enforced in grantBadge so no code path can create a second.
export const BADGE_AUTHOR = "author";
export const BADGE_DEV = "dev";
export const BADGE_EARLY = "early";
export const BADGE_SHITPOSTER = "shitposter";
// Held only while the account is in the trending card; see syncTrendingBadges.
export const BADGE_TRENDING = "trending";

export const BADGES = [
  BADGE_AUTHOR,
  BADGE_DEV,
  BADGE_EARLY,
  BADGE_SHITPOSTER,
  BADGE_TRENDING,
] as const;

export type Badge = (typeof BADGES)[number];

// A user earns the shitposter badge by creating this many posts (posts and
// gusts both count) inside this rolling window.
export const SHITPOSTER_THRESHOLD = 5;
export const SHITPOSTER_WINDOW_MS = 30 * 60 * 1000;

// Precedence order for badge resolution: the first (lowest number) is the
// primary badge. This covers only the PLATFORM badges this module hands out;
// the client ranks them on one table together with community roles
// (author -> owner -> moderator -> dev -> shitposter -> member -> early), so
// the relative order here mirrors that table for the keys this side knows.
const BADGE_PRECEDENCE: Record<string, number> = {
  author: 0,
  dev: 1,
  early: 3,
  shitposter: 2,
  trending: 4,
};

// Resolves a row's badge state into a single deduped list ordered by
// precedence. Both storage locations are merged - the `badges` array plus the
// legacy single `badge` column - so a badge held in either place is never
// dropped and the highest-precedence badge comes first.
export function getUserBadges(user: {
  badge?: string | null;
  badges?: string[] | null;
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
  return (error as { code?: string })?.code === "P2002";
}

// Canonicalizes a badge input to the lowercase canonical form and validates it
// against the known set, so values like "AUTHOR" / "DEV" behave identically to
// "author" / "dev" and unsupported values are rejected before any rule runs.
export function canonicalBadge(value: string): Badge | null {
  const normalized = value.trim().toLowerCase();
  return BADGES.includes(normalized as Badge) ? (normalized as Badge) : null;
}

async function assertAuthorSlot(userId: string) {
  const currentAuthor = await prisma.user.findFirst({
    select: { id: true },
    where: {
      OR: [{ badge: BADGE_AUTHOR }, { badges: { has: BADGE_AUTHOR } }],
      id: { not: userId },
    },
  });
  if (currentAuthor) {
    throw new BadgeLimitError("Only one author is allowed for the app.");
  }
}

// Grants a badge to a user, returning false when they already hold it. The
// author badge is single-slot: a partial unique index on users(badge) where
// badge='author' (see the docker prisma scripts) makes concurrent grants
// atomic at the database level, so a second author is rejected even under
// races - the P2002 conflict surfaces as BadgeLimitError. The legacy `badge`
// column is used for the author slot since it is the column the index guards.
export async function grantBadge(
  userId: string,
  badge: string
): Promise<boolean> {
  const canonical = canonicalBadge(badge);
  if (!canonical) {
    return false;
  }

  if (canonical === BADGE_AUTHOR) {
    // Early user-facing validation; the DB constraint is the authoritative
    // backstop against concurrent grants.
    await assertAuthorSlot(userId);
    const holder = await prisma.user.findUnique({
      select: { badge: true, badges: true },
      where: { id: userId },
    });
    if (holder && getUserBadges(holder).includes(BADGE_AUTHOR)) {
      return false;
    }
    try {
      await prisma.user.update({
        data: { badge: BADGE_AUTHOR },
        where: { id: userId },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new BadgeLimitError("Only one author is allowed for the app.");
      }
      throw error;
    }
  }

  const user = await prisma.user.findUnique({
    select: { badge: true, badges: true },
    where: { id: userId },
  });
  if (!user) {
    return false;
  }

  const current = getUserBadges(user);
  if (current.includes(canonical)) {
    return false;
  }

  await prisma.user.update({
    data: { badges: [...current, canonical] },
    where: { id: userId },
  });
  return true;
}

// Removes a badge from a user. The author badge is never revocable this way so
// the app always keeps exactly one author once one is set.
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

  const user = await prisma.user.findUnique({
    select: { badge: true, badges: true },
    where: { id: userId },
  });
  if (!user) {
    return false;
  }

  // Derive the normalized list (legacy `badge` folded in), filter the badge out
  // and persist the array, clearing the legacy column so the badge stops
  // rendering from either storage location.
  const next = getUserBadges(user).filter((value) => value !== canonical);
  if (next.length === getUserBadges(user).length) {
    return false;
  }

  await prisma.user.update({
    data: {
      badge: user.badge === canonical ? null : user.badge,
      badges: next,
    },
    where: { id: userId },
  });
  return true;
}

// The automated shitposter detector: grants the badge when the user has hit the
// posting threshold inside the rolling window. Posts and gusts both count. Safe
// to call on every post creation; it no-ops for users who already hold the
// badge.
export async function grantShitposterBadgeIfQualified(
  userId: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    select: { badge: true, badges: true },
    where: { id: userId },
  });
  if (!user) {
    return false;
  }
  if (getUserBadges(user).includes(BADGE_SHITPOSTER)) {
    return false;
  }

  const windowStart = new Date(Date.now() - SHITPOSTER_WINDOW_MS);
  const recentPosts = await prisma.post.count({
    // Responses are conversation, not timeline posts: they must not push an
    // author over the shitposter threshold.
    where: { createdAt: { gte: windowStart }, rootPostId: null, userId },
  });

  if (recentPosts < SHITPOSTER_THRESHOLD) {
    return false;
  }

  return await grantBadge(userId, BADGE_SHITPOSTER);
}

// ---------------------------------------------------------------------------
// Early supporter
// ---------------------------------------------------------------------------
// A founding-era reward: reach EARLY_AURA_THRESHOLD aura at any point before
// EARLY_DEADLINE and the badge is granted, then kept for good (grantBadge is
// one-way and no path revokes it). Both values are config so the campaign can
// be retuned or retired without touching code.
//
// Qualification is evaluated by a periodic sweep rather than hooked into every
// aura write: aura moves from votes, comments, follows, mentions, views and
// more, and threading a badge check through the ledger would put a user read on
// every one of those. The sweep reads the indexed aura column in batches and
// stops early once the deadline passes.
export const EARLY_AURA_THRESHOLD = 5000;
export const EARLY_DEADLINE = new Date("2026-12-31T23:59:59.999Z");

export function isEarlyBadgeWindowOpen(now: Date = new Date()): boolean {
  return now.getTime() < EARLY_DEADLINE.getTime();
}

// Grants the early badge to one user if they qualify right now. Safe to call
// repeatedly: grantBadge returns false when the badge is already held.
export async function grantEarlyBadgeIfQualified(
  userId: string,
  now: Date = new Date()
): Promise<boolean> {
  if (!isEarlyBadgeWindowOpen(now)) {
    return false;
  }
  const user = await prisma.user.findUnique({
    select: { aura: true },
    where: { id: userId },
  });
  if (!user || user.aura < EARLY_AURA_THRESHOLD) {
    return false;
  }
  return await grantBadge(userId, BADGE_EARLY);
}

// Batched sweep over everyone who currently qualifies but does not yet hold the
// badge. Paged by id so a large deployment never loads the candidate set at
// once, and the candidate set shrinks to empty as the campaign runs. Returns
// how many were newly granted.
export async function sweepEarlyBadges(
  now: Date = new Date(),
  batchSize = 200
): Promise<number> {
  if (!isEarlyBadgeWindowOpen(now)) {
    return 0;
  }

  let granted = 0;
  let cursor: string | undefined;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- paged sweep must await each page
    const batch = await prisma.user.findMany({
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: "asc" },
      select: { id: true },
      skip: cursor ? 1 : 0,
      take: batchSize,
      // Exclude holders by the ARRAY only, never by the legacy `badge` column.
      // That column is nullable, so a NOT over it compiles to
      // `NOT (badge = 'early')` - which is NULL for every user whose legacy
      // badge is unset, and SQL's three-valued logic drops those rows. That
      // silently excluded nearly everyone and the sweep granted nothing.
      // `badges` is non-nullable (@default([])), so a NOT over it is safe.
      //
      // Legacy-column holders are still handled: grantBadge merges both storage
      // locations and returns false when the badge is already held, so such a
      // user is re-read each sweep but never granted twice.
      where: {
        NOT: { badges: { has: BADGE_EARLY } },
        aura: { gte: EARLY_AURA_THRESHOLD },
      },
    });

    if (batch.length === 0) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop -- paged sweep must await each page
    const results = await Promise.all(
      batch.map((user) => grantBadge(user.id, BADGE_EARLY))
    );
    granted += results.filter(Boolean).length;

    if (batch.length < batchSize) {
      break;
    }
    cursor = batch.at(-1)?.id;
  }

  return granted;
}

// ---------------------------------------------------------------------------
// Trending
// ---------------------------------------------------------------------------
// The trending badge is PRESENCE-based, not an achievement: it is held only
// while the account is in the trending card and released the moment they drop
// off, so the badge tracks the live ranking instead of accumulating. The list
// is ranked exactly as the card ranks it (most followers, then aura); the size
// is shared so the two cannot drift.
export const TRENDING_BADGE_SIZE = 6;

export async function getTrendingUserIds(
  limit: number = TRENDING_BADGE_SIZE
): Promise<string[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ followers: { _count: "desc" } }, { aura: "desc" }],
    select: { id: true },
    take: Math.max(1, limit),
    where: { id: { not: SYSTEM_MODERATION_USER_ID } },
  });
  return users.map((user) => user.id);
}

export interface TrendingBadgeSyncResult {
  granted: number;
  revoked: number;
}

// Reconciles the trending badge against `currentUserIds`: grants to everyone on
// the list, revokes from every holder who has dropped off. Idempotent, so it is
// safe to run on any cadence and after any Redis loss.
//
// Holders are found by the indexed `badges` array rather than a Redis set: the
// database stays the single source of truth, so a cache flush cannot strand a
// badge on an account that is no longer trending.
export async function syncTrendingBadges(
  currentUserIds: string[]
): Promise<TrendingBadgeSyncResult> {
  const current = new Set(currentUserIds.filter(Boolean));

  const holders = await prisma.user.findMany({
    select: { id: true },
    where: { badges: { has: BADGE_TRENDING } },
  });
  const holderIds = new Set(holders.map((holder) => holder.id));

  const toGrant = [...current].filter((id) => !holderIds.has(id));
  const toRevoke = [...holderIds].filter((id) => !current.has(id));

  // Both sides are independent sets of single-row writes, so they run in
  // parallel rather than one round trip per account.
  const [grantedResults, revokedResults] = await Promise.all([
    Promise.all(toGrant.map((id) => grantBadge(id, BADGE_TRENDING))),
    Promise.all(toRevoke.map((id) => revokeBadge(id, BADGE_TRENDING))),
  ]);

  return {
    granted: grantedResults.filter(Boolean).length,
    revoked: revokedResults.filter(Boolean).length,
  };
}

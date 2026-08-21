import prisma from "./prisma";

// Badge values stored on User.badges. "author" is special: the app allows at
// most one holder, enforced in grantBadge so no code path can create a second.
export const BADGE_AUTHOR = "author";
export const BADGE_DEV = "dev";
export const BADGE_EARLY = "early";
export const BADGE_SHITPOSTER = "shitposter";

export const BADGES = [
  BADGE_AUTHOR,
  BADGE_DEV,
  BADGE_EARLY,
  BADGE_SHITPOSTER,
] as const;

export type Badge = (typeof BADGES)[number];

// A user earns the shitposter badge by creating this many posts (posts and
// gusts both count) inside this rolling window.
export const SHITPOSTER_THRESHOLD = 5;
export const SHITPOSTER_WINDOW_MS = 30 * 60 * 1000;

// Precedence order for badge resolution: the first (lowest number) is the
// primary badge. Mirrors the client BADGE_ORDER so server-side decisions
// (dedupe, slot checks) agree with what renders.
const BADGE_PRECEDENCE: Record<string, number> = {
  author: 0,
  dev: 1,
  early: 2,
  shitposter: 3,
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
  if (badge === BADGE_AUTHOR) {
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
  if (current.includes(badge)) {
    return false;
  }

  await prisma.user.update({
    data: { badges: [...current, badge] },
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
  if (badge === BADGE_AUTHOR) {
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
  const next = getUserBadges(user).filter((value) => value !== badge);
  if (next.length === getUserBadges(user).length) {
    return false;
  }

  await prisma.user.update({
    data: { badge: user.badge === badge ? null : user.badge, badges: next },
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
    where: { createdAt: { gte: windowStart }, userId },
  });

  if (recentPosts < SHITPOSTER_THRESHOLD) {
    return false;
  }

  return await grantBadge(userId, BADGE_SHITPOSTER);
}

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

// Resolves a row's badge state into a single deduped list. New grants write to
// the `badges` array; the legacy single `badge` column is folded in as a
// fallback so pre-migration rows still render.
export function getUserBadges(user: {
  badge?: string | null;
  badges?: string[] | null;
}): string[] {
  const list = [...(user.badges ?? [])];
  if (list.length === 0 && user.badge) {
    list.push(user.badge);
  }
  return [...new Set(list)];
}

export class BadgeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadgeLimitError";
  }
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
// author badge is single-slot: granting it to a second user throws so the "one
// author" rule is enforced in every granting code path.
export async function grantBadge(
  userId: string,
  badge: string
): Promise<boolean> {
  if (badge === BADGE_AUTHOR) {
    await assertAuthorSlot(userId);
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
    select: { badges: true },
    where: { id: userId },
  });
  if (!user) {
    return false;
  }

  const next = (user.badges ?? []).filter((value) => value !== badge);
  if (next.length === user.badges.length) {
    return false;
  }

  await prisma.user.update({
    data: { badges: next },
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

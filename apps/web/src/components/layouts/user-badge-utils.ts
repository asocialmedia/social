export type UserBadgeType =
  | "author"
  | "dev"
  | "early"
  | "shitposter"
  | "trending";

const KNOWN_BADGES = new Set<UserBadgeType>([
  "author",
  "dev",
  "early",
  "shitposter",
  "trending",
]);

// The single display precedence across BOTH badge families. Platform badges
// (author/dev/early/shitposter) and community roles (owner/moderator/member)
// are ordered together rather than as two blocks, so a community owner
// outranks a developer instead of sitting after every platform badge.
//
// Order: author -> owner -> moderator -> dev -> shitposter -> member -> early
// -> trending. Anything unrecognised sorts last. This is the display order
// only; it does not affect who holds which badge.
export const BADGE_PRECEDENCE = [
  "author",
  "owner",
  "moderator",
  "dev",
  "shitposter",
  "member",
  "early",
  // Presence-based, so it trails the earned badges: it says where you are right
  // now, not what you have done.
  "trending",
] as const;

export type BadgePrecedenceKey = (typeof BADGE_PRECEDENCE)[number];

// Rank for any badge or role key. Case-insensitive, because the two families
// store their values differently: platform badges are lowercase ("author")
// while community roles are uppercase ("OWNER"). Unknown keys sort after every
// known one, so a future badge can be added to the data model before its
// placing is decided without crashing or jumping the queue.
export function badgeRank(key: string): number {
  const index = BADGE_PRECEDENCE.indexOf(
    key.toLowerCase() as BadgePrecedenceKey
  );
  return index === -1 ? BADGE_PRECEDENCE.length : index;
}

// Maps a stored badge value to a known type. Unknown values are dropped so a
// bad DB toggle never shows a broken image.
export function normalizeBadge(
  value: string | null | undefined
): UserBadgeType | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  return KNOWN_BADGES.has(normalized as UserBadgeType)
    ? (normalized as UserBadgeType)
    : null;
}

// Normalizes a stored badge list, dropping unknown values, deduping and sorting
// by display precedence. The primary badge rendered inline is the first one;
// the rest are shown behind the "+N" chip and inside the panel.
export function normalizeBadges(
  values: (string | null | undefined)[] | null | undefined
): UserBadgeType[] {
  if (!values) {
    return [];
  }
  const seen = new Set<UserBadgeType>();
  const result: UserBadgeType[] = [];
  for (const value of values) {
    const type = normalizeBadge(value);
    if (type && !seen.has(type)) {
      seen.add(type);
      result.push(type);
    }
  }
  return [...result].toSorted((a, b) => badgeRank(a) - badgeRank(b));
}

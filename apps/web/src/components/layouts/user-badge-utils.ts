export type UserBadgeType = "author" | "dev" | "early" | "shitposter";

const KNOWN_BADGES = new Set<UserBadgeType>([
  "author",
  "dev",
  "early",
  "shitposter",
]);

// Precedence for the primary badge shown inline: the first (lowest number) is
// rendered as the banner and the rest collapse into the "+N" chip. Author
// outranks every earned/honor badge so it always leads when present.
export const BADGE_ORDER: Record<UserBadgeType, number> = {
  author: 0,
  dev: 1,
  early: 2,
  shitposter: 3,
};

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
// by precedence. The primary badge rendered inline is the first one; the rest
// are shown behind the "+N" chip and inside the tooltip.
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
  return [...result].toSorted((a, b) => BADGE_ORDER[a] - BADGE_ORDER[b]);
}

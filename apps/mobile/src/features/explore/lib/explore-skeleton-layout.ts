// Pure layout math for the Explore loading skeleton, kept free of React Native
// so it is unit-testable on Node. The skeleton mirrors the real masonry feed:
// post cards with user cards interleaved every sixth slot, split into two
// columns. These helpers decide that shape.

export interface SkeletonItem {
  aspect?: number;
  kind: "post" | "user";
}

// Aspect ratios copied from the web masonry skeleton so the placeholder rows
// have varied heights the way the real cards do.
export const SKELETON_POST_ASPECTS = [
  4 / 5,
  3 / 4,
  1,
  4 / 5,
  3 / 4,
  1,
  4 / 5,
  3 / 4,
] as const;

// Interleaves a user card before every sixth slot, matching how the feed
// mixes people into the post stream (`index % 6 === 0`, first slot excluded).
export function buildMasonryLayout(
  aspects: readonly number[] = SKELETON_POST_ASPECTS
): SkeletonItem[] {
  const items: SkeletonItem[] = [];
  for (let index = 0; index < aspects.length; index += 1) {
    if (index > 0 && index % 6 === 0) {
      items.push({ kind: "user" });
    }
    items.push({ aspect: aspects[index], kind: "post" });
  }
  return items;
}

// Splits items into the two columns the masonry row renders, alternating so
// the columns stay roughly balanced.
export function splitIntoColumns(items: readonly SkeletonItem[]): {
  left: SkeletonItem[];
  right: SkeletonItem[];
} {
  const left: SkeletonItem[] = [];
  const right: SkeletonItem[] = [];
  for (const [index, item] of items.entries()) {
    (index % 2 === 0 ? left : right).push(item);
  }
  return { left, right };
}

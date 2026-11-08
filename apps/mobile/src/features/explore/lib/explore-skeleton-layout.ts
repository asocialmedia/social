// Pure layout math for the Explore loading skeleton, kept free of React
// Native so it is unit-testable on Node. The skeleton mirrors the real
// masonry feed: post cards with user cards interleaved, split into two
// columns. These helpers decide that shape.

// Aspect ratios copied from web's explore-masonry-skeleton so the placeholder
// rows have varied heights the way the real cards do.
export const SKELETON_POST_ASPECTS = [
  4 / 5,
  3 / 4,
  1,
  4 / 5,
  3 / 4,
  1,
  4 / 5,
  3 / 4,
  1,
  4 / 5,
] as const;

// Web interleaves a user card at slots 4 and 9 of the 10-item skeleton
// stream (the feed mixes people into the post stream every sixth slot).
export const SKELETON_USER_SLOTS = [4, 9] as const;

export const EXPLORE_INITIAL_SKELETON_POSTS = 8;
export const EXPLORE_GUSTS_SKELETON_COUNT = 8;
export const EXPLORE_PEOPLE_SKELETON_COUNT = 8;
export const EXPLORE_CONTINUATION_SKELETON_COUNT = 4;

export interface SkeletonItem {
  aspect?: number;
  kind: "post" | "user";
}

// Interleaves a user card at web's user slots, matching the explore page's
// loading skeleton (user cards at index 4 and 9 of the stream).
export function buildMasonryLayout(
  aspects: readonly number[] = SKELETON_POST_ASPECTS
): SkeletonItem[] {
  const items: SkeletonItem[] = [];
  for (let index = 0; index < aspects.length; index += 1) {
    if (
      SKELETON_USER_SLOTS.includes(
        index as (typeof SKELETON_USER_SLOTS)[number]
      )
    ) {
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

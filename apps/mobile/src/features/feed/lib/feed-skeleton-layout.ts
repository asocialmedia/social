// Pure layout math for the home-feed loading skeleton, kept free of React
// Native so it is unit-testable on Node. Mirrors web's post-card-skeleton:
// the same 8 rotating card profiles (album / text / image / vertical with
// web's text-line counts and aspect ratios), the same text-line width rule,
// the alternating Bluesky treatment, and the same item counts (8 initial,
// 4 load-more).
export type FeedSkeletonSource = "all" | "asm" | "bluesky";

export interface DynamicSkeletonProfile {
  albumCount?: number;
  aspectRatio?: number;
  kind: "album" | "image" | "vertical" | "text" | "unknown";
  textLines: number;
}

// Varied profiles matching web's DYNAMIC_SKELETON_PROFILES so the placeholder
// rows read like realistic feed posts: albums, text, landscape and vertical.
export const DYNAMIC_SKELETON_PROFILES: readonly DynamicSkeletonProfile[] = [
  { albumCount: 2, aspectRatio: 3 / 2, kind: "album", textLines: 2 },
  { kind: "text", textLines: 4 },
  { aspectRatio: 16 / 9, kind: "image", textLines: 2 },
  { aspectRatio: 3 / 4, kind: "vertical", textLines: 1 },
  { albumCount: 4, aspectRatio: 1, kind: "album", textLines: 1 },
  { kind: "text", textLines: 3 },
  { aspectRatio: 4 / 3, kind: "image", textLines: 2 },
  { aspectRatio: 4 / 5, kind: "vertical", textLines: 2 },
] as const;

export const FEED_INITIAL_SKELETON_COUNT = 8;
export const FEED_LOAD_MORE_SKELETON_COUNT = 4;

// Web's FeedViewSkeleton alternates Bluesky rows on the mixed ("all") feed:
// odd rows render the Bluesky treatment. A single-source feed follows the
// source instead.
export function isBlueskySkeletonIndex(
  source: FeedSkeletonSource,
  index: number
): boolean {
  if (source === "bluesky") {
    return true;
  }
  if (source === "asm") {
    return false;
  }
  return index % 2 === 1;
}

export function skeletonProfileForIndex(index: number): DynamicSkeletonProfile {
  const profile =
    DYNAMIC_SKELETON_PROFILES[index % DYNAMIC_SKELETON_PROFILES.length];
  if (!profile) {
    return { kind: "text", textLines: 2 };
  }
  return profile;
}

// Web's getLineSkeletonWidth: the last line is 3/4, odd lines are 11/12,
// everything else is full width. Returned as width fractions.
export function skeletonLineWidth(
  lineIndex: number,
  lineCount: number
): number {
  if (lineIndex === lineCount - 1) {
    return 0.75;
  }
  if (lineIndex % 2 === 1) {
    return 11 / 12;
  }
  return 1;
}

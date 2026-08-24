export interface TrendingScoreInput {
  aura: number;
  bookmarkCount: number;
  commentCount: number;
  createdAt: Date;
  viewCount: number;
  now?: Date;
}

// Signal weights: comments and bookmarks signal deliberate engagement and are
// worth more than raw aura; views are cheap and weighted lightly so passive
// scrolling cannot dominate the ranking.
const AURA_WEIGHT = 1;
const COMMENT_WEIGHT = 3;
const BOOKMARK_WEIGHT = 5;
const VIEW_WEIGHT = 0.05;

// HackerNews-style gravity: scores fall off with age^1.5. The +2h floor keeps
// brand-new posts (age ~0) from getting an infinite boost and gives every post
// a short grace window to accumulate its first signals.
const AGE_EXPONENT = 1.5;
const AGE_FLOOR_HOURS = 2;

const MS_PER_HOUR = 3_600_000;

// Pure time-decayed momentum score for a single post. Higher is hotter.
// Deterministic: callers pass `now` explicitly (worker jobs, backfills, tests);
// production call sites that omit it get the current wall clock.
export function computeTrendingScore(input: TrendingScoreInput): number {
  const now = input.now ?? new Date();
  const ageHours = Math.max(
    0,
    (now.getTime() - input.createdAt.getTime()) / MS_PER_HOUR
  );

  const engagement =
    input.aura * AURA_WEIGHT +
    input.commentCount * COMMENT_WEIGHT +
    input.bookmarkCount * BOOKMARK_WEIGHT +
    input.viewCount * VIEW_WEIGHT;

  // Aura can go negative on downvoted posts; a net-negative post must never
  // trend, so clamp the aggregate at zero rather than letting it leak below.
  return Math.max(0, engagement) / (ageHours + AGE_FLOOR_HOURS) ** AGE_EXPONENT;
}

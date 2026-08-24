// Predicted-interest scoring for For-You feed candidates. Blends four 0..1
// components into a 0..100 score: author affinity (40), topic overlap (30),
// freshness with a 12h half-life (20), and log-scaled early traction (10).
// Pure and deterministic: `now` is injected by callers (service, tests).

import type { UserProfile } from "./profile";

export interface CandidatePost {
  aura: number;
  authorId: string;
  bookmarkCount: number;
  commentCount: number;
  createdAt: Date;
  id: string;
  tags: string[];
}

export interface ScoreCandidateOptions {
  followedAuthorIds?: ReadonlySet<string>;
  now?: Date;
}

// Component scores before weighting, exported for observability so dev tooling
// can explain exactly why a post ranked where it did.
export interface CandidateScoreComponents {
  authorAffinity: number;
  freshness: number;
  tagOverlap: number;
  traction: number;
}

// An author saturates affinity once they hold ~20% of the profile's
// engagement mass; anything beyond that does not score higher.
const AUTHOR_AFFINITY_SATURATION = 0.2;
// Following an author guarantees at least this much affinity even with no
// recorded engagement yet, so followed authors are not cold-started to zero.
const FOLLOWED_AUTHOR_BASELINE = 0.4;
// A post's tags saturate overlap once they cover ~30% of the profile's
// topical engagement mass.
const TAG_OVERLAP_SATURATION = 0.3;
// Freshness decays exponentially, halving every FRESHNESS_HALF_LIFE_HOURS.
const FRESHNESS_HALF_LIFE_HOURS = 12;
// Early-traction weights mirror the trending score's signal weights
// (comment = 3 aura, bookmark = 5 aura) so both rankers agree on how much
// each engagement kind matters. Views are excluded: passive and gameable,
// they would stretch the log band without adding signal.
const TRACTION_COMMENT_WEIGHT = 3;
const TRACTION_BOOKMARK_WEIGHT = 5;
// Aura-equivalent traction at which the band saturates.
const TRACTION_SATURATION_COUNT = 300;

const AUTHOR_AFFINITY_POINTS = 40;
const TAG_OVERLAP_POINTS = 30;
const FRESHNESS_POINTS = 20;
const TRACTION_POINTS = 10;

const MS_PER_HOUR = 3_600_000;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function scoreCandidateComponents(
  post: CandidatePost,
  profile: UserProfile,
  options: ScoreCandidateOptions = {}
): CandidateScoreComponents {
  const now = options.now ?? new Date();
  // A cold-start user may have an entirely empty profile; treat any missing
  // weight map as all-zero affinities rather than crashing.
  const authorWeights = profile.authorWeights ?? {};
  const tagWeights = profile.tagWeights ?? {};

  const rawAffinity = authorWeights[post.authorId] ?? 0;
  let authorAffinity = Math.min(1, rawAffinity / AUTHOR_AFFINITY_SATURATION);
  if (options.followedAuthorIds?.has(post.authorId)) {
    authorAffinity = Math.max(authorAffinity, FOLLOWED_AUTHOR_BASELINE);
  }

  const distinctTags = [...new Set(post.tags)].filter(Boolean);
  let tagMass = 0;
  for (const tag of distinctTags) {
    tagMass += tagWeights[tag] ?? 0;
  }
  const tagOverlap = Math.min(1, tagMass / TAG_OVERLAP_SATURATION);

  const ageHours = Math.max(
    0,
    (now.getTime() - post.createdAt.getTime()) / MS_PER_HOUR
  );
  const freshness = clamp01(0.5 ** (ageHours / FRESHNESS_HALF_LIFE_HOURS));

  const tractionRaw =
    Math.max(0, post.aura) +
    Math.max(0, post.commentCount) * TRACTION_COMMENT_WEIGHT +
    Math.max(0, post.bookmarkCount) * TRACTION_BOOKMARK_WEIGHT;
  const traction = clamp01(
    Math.log1p(tractionRaw) / Math.log1p(TRACTION_SATURATION_COUNT)
  );

  return { authorAffinity, freshness, tagOverlap, traction };
}

// Who you know beats what you know beats how new it beats early traction.
export function scoreCandidate(
  post: CandidatePost,
  profile: UserProfile,
  options: ScoreCandidateOptions = {}
): number {
  const components = scoreCandidateComponents(post, profile, options);
  return (
    components.authorAffinity * AUTHOR_AFFINITY_POINTS +
    components.tagOverlap * TAG_OVERLAP_POINTS +
    components.freshness * FRESHNESS_POINTS +
    components.traction * TRACTION_POINTS
  );
}

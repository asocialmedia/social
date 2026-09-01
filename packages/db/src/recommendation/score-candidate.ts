// Predicted-interest scoring for For-You feed candidates.
// Blends author affinity (40), topic/semantic overlap (30), freshness (20),
// and early traction (10) into a 0..100 base score, enhanced with vector
// embedding similarity, media format fit, and soft visited cooldown.
// Pure and deterministic: `now` is injected by callers (service, tests).

import type { UserProfile } from "./profile";
import { cosineSimilarity } from "./vector";

export interface CandidatePost {
  aura: number;
  authorId: string;
  bookmarkCount: number;
  commentCount: number;
  createdAt: Date;
  id: string;
  semanticTags?: string[];
  tags: string[];
  // Enhanced media & semantic features
  embedding?: number[];
  hasAiBadge?: boolean;
  hasAudio?: boolean;
  hasImage?: boolean;
  hasOcr?: boolean;
  hasTranscript?: boolean;
  hasVideo?: boolean;
  isVisited?: boolean;
}

export interface ScoreCandidateOptions {
  // Author's aura visibility weight (0.4..1 from the reputation economy).
  // Applied as a final multiplicative quality factor so negative-balance
  // authors rank proportionally lower without any hard exclusion; defaults
  // to neutral 1 when unknown.
  authorVisibilityWeight?: number;
  followedAuthorIds?: ReadonlySet<string>;
  now?: Date;
}

// Component scores before weighting, exported for observability so dev tooling
// can explain exactly why a post ranked where it did.
export interface CandidateScoreComponents {
  authorAffinity: number;
  freshness: number;
  mediaFit: number;
  semanticSimilarity: number;
  tagOverlap: number;
  traction: number;
  visitedMultiplier: number;
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
// each engagement kind matters.
const TRACTION_COMMENT_WEIGHT = 3;
const TRACTION_BOOKMARK_WEIGHT = 5;
// Aura-equivalent traction at which the band saturates.
const TRACTION_SATURATION_COUNT = 300;

export const AUTHOR_AFFINITY_POINTS = 40;
export const TAG_OVERLAP_POINTS = 30;
export const FRESHNESS_POINTS = 20;
export const TRACTION_POINTS = 10;

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
  const authorWeights = profile.authorWeights ?? {};
  const tagWeights = profile.tagWeights ?? {};
  const negativeAuthorWeights = profile.negativeAuthorWeights ?? {};
  const negativeTagWeights = profile.negativeTagWeights ?? {};

  // 1. Author Affinity (positive signals minus negative dismissals)
  const rawAffinity = authorWeights[post.authorId] ?? 0;
  let authorAffinity = Math.min(1, rawAffinity / AUTHOR_AFFINITY_SATURATION);
  if (options.followedAuthorIds?.has(post.authorId)) {
    authorAffinity = Math.max(authorAffinity, FOLLOWED_AUTHOR_BASELINE);
  }
  const negativeAuthorPenalty = negativeAuthorWeights[post.authorId] ?? 0;
  if (negativeAuthorPenalty > 0) {
    authorAffinity = Math.max(0, authorAffinity - negativeAuthorPenalty * 2);
  }

  // 2. Tag Overlap & Negative Tag Demotion
  const distinctTags = [
    ...new Set([...post.tags, ...(post.semanticTags ?? [])]),
  ].filter(Boolean);
  let tagMass = 0;
  let negativeTagMass = 0;
  for (const tag of distinctTags) {
    const direct = tagWeights[tag] ?? 0;
    const graph = profile.expandedEntityWeights?.[tag]
      ? profile.expandedEntityWeights[tag] * 0.7
      : 0;
    tagMass += Math.max(direct, graph);
    negativeTagMass += negativeTagWeights[tag] ?? 0;
  }
  let rawTagOverlap = Math.min(1, tagMass / TAG_OVERLAP_SATURATION);
  if (negativeTagMass > 0) {
    rawTagOverlap = Math.max(0, rawTagOverlap - negativeTagMass);
  }

  // 3. Semantic Vector Similarity (384-dimensional cosine similarity)
  let semanticSimilarity = 0;
  if (
    post.embedding &&
    post.embedding.length > 0 &&
    profile.tasteVector &&
    profile.tasteVector.length > 0
  ) {
    const cos = cosineSimilarity(post.embedding, profile.tasteVector);
    semanticSimilarity = clamp01(cos);
  }

  // Blended topic score: exact tag overlap + semantic vector similarity
  // If vector similarity is present, blend it so semantically matched posts rank high
  // even without exact tag matches, while never lowering a pure tag match.
  const tagOverlap =
    semanticSimilarity > 0
      ? Math.max(rawTagOverlap, rawTagOverlap * 0.4 + semanticSimilarity * 0.6)
      : rawTagOverlap;

  // 4. Freshness
  const ageHours = Math.max(
    0,
    (now.getTime() - post.createdAt.getTime()) / MS_PER_HOUR
  );
  const freshness = clamp01(0.5 ** (ageHours / FRESHNESS_HALF_LIFE_HOURS));

  // 5. Early Traction
  const tractionRaw =
    Math.max(0, post.aura) +
    Math.max(0, post.commentCount) * TRACTION_COMMENT_WEIGHT +
    Math.max(0, post.bookmarkCount) * TRACTION_BOOKMARK_WEIGHT;
  const traction = clamp01(
    Math.log1p(tractionRaw) / Math.log1p(TRACTION_SATURATION_COUNT)
  );

  // 6. Media Format Fit
  let mediaFit = 1;
  if (profile.formatAffinities) {
    if (post.hasVideo && profile.formatAffinities.video > 0.35) {
      mediaFit += 0.15;
    } else if (post.hasImage && profile.formatAffinities.image > 0.35) {
      mediaFit += 0.1;
    } else if (post.hasAudio && profile.formatAffinities.audio > 0.3) {
      mediaFit += 0.1;
    }
  }
  if (post.hasTranscript || post.hasOcr) {
    mediaFit += 0.05; // Quality bonus for rich verified media
  }

  // 7. Visited Soft Multiplier (instead of deleting/hiding visited posts)
  const visitedMultiplier = post.isVisited ? 0.35 : 1;

  return {
    authorAffinity,
    freshness,
    mediaFit,
    semanticSimilarity,
    tagOverlap,
    traction,
    visitedMultiplier,
  };
}

// Who you know beats what you know beats how new it beats early traction -
// scaled by the author's reputation visibility weight and visited cooldown.
export function scoreCandidate(
  post: CandidatePost,
  profile: UserProfile,
  options: ScoreCandidateOptions = {}
): number {
  const components = scoreCandidateComponents(post, profile, options);
  const base =
    components.authorAffinity * AUTHOR_AFFINITY_POINTS +
    components.tagOverlap * TAG_OVERLAP_POINTS +
    components.freshness * FRESHNESS_POINTS +
    components.traction * TRACTION_POINTS;

  // Scale by format fit and reputation visibility, then apply soft visited cooldown
  const mediaScaled = base * clamp01(options.authorVisibilityWeight ?? 1);
  return mediaScaled * components.visitedMultiplier;
}

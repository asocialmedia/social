import { createLogger } from "@asm/logger";

const logger = createLogger({ serviceName: "suggested-scoring" });

export interface SuggestionCandidate {
  id: string;
  aura: number;
  createdAt: Date;
  followerCount: number;
  mutualCount: number;
  mutualFollowers: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  }[];
  recentPostAt: Date | null;
  tagOverlap: number;
  postCount: number;
}

export interface ViewerInterests {
  followedIds: Set<string>;
  tagFrequency: Map<string, number>;
  topTags: Set<string>;
}

export interface ScoringWeights {
  mutual: number;
  tagOverlap: number;
  recency: number;
  popularity: number;
  activity: number;
  diversityJitter: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  activity: 0.8,
  diversityJitter: 0.6,
  mutual: 4,
  popularity: 1.2,
  recency: 1.8,
  tagOverlap: 2.5,
};

// --- pure scoring -----------------------------------------------------------

export function scoreCandidate(
  candidate: SuggestionCandidate,
  interests: ViewerInterests,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  let score = 0;

  // 1. Mutual connections: log-scaled to avoid single mega-mutual dominating
  if (candidate.mutualCount > 0) {
    const mutualScore = Math.log1p(candidate.mutualCount) * 10;
    score += mutualScore * weights.mutual;
    logger.debug(
      {
        candidateId: candidate.id,
        mutualCount: candidate.mutualCount,
        mutualScore,
      },
      "mutual score"
    );
  }

  // 2. Tag overlap: how many of the viewer's top tags appear in candidate's posts
  if (candidate.tagOverlap > 0) {
    const tagScore = Math.log1p(candidate.tagOverlap) * 8;
    score += tagScore * weights.tagOverlap;
  }

  // 3. Recency: boost recently active creators, penalize dormant
  if (candidate.recentPostAt) {
    const daysSincePost =
      (Date.now() - candidate.recentPostAt.getTime()) / (1000 * 60 * 60 * 24);
    let recencyBoost = 0;
    if (daysSincePost <= 7) {
      recencyBoost = 6;
    } else if (daysSincePost <= 30) {
      recencyBoost = 3;
    } else if (daysSincePost <= 90) {
      recencyBoost = 1;
    } else {
      recencyBoost = -2;
    }
    score += recencyBoost * weights.recency;
  } else {
    // No posts at all -> slight penalty
    score -= 1 * weights.recency;
  }

  // 4. Popularity: log-scaled aura + follower count, with diminishing returns
  // This ensures high-aura users surface but don't drown out fresh creators
  const popularityRaw =
    Math.log1p(Math.max(0, candidate.aura)) * 0.5 +
    Math.log1p(candidate.followerCount) * 0.5;
  score += popularityRaw * weights.popularity;

  // 5. Activity: post count as a proxy for being an active creator
  if (candidate.postCount > 0) {
    const activityScore = Math.log1p(candidate.postCount) * 2;
    score += activityScore * weights.activity;
  }

  // 6. Exploration jitter: small random noise to diversify and surface fresh faces
  // Epsilon-greedy: 85% exploit (score), 15% explore (random boost)
  const jitter = (Math.random() - 0.5) * 2 * weights.diversityJitter;
  score += jitter;

  // 7. New-account boost: very new accounts (<7 days) get a tiny discovery boost
  // so the system doesn't only surface veterans
  const daysSinceCreation =
    (Date.now() - candidate.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation <= 7 && candidate.postCount > 0) {
    score += 2;
  }

  return score;
}

export function rankCandidates(
  candidates: SuggestionCandidate[],
  interests: ViewerInterests,
  weights?: ScoringWeights
): (SuggestionCandidate & { score: number; reasons: string[] })[] {
  const scored = candidates.map((candidate) => {
    const score = scoreCandidate(candidate, interests, weights);
    const reasons: string[] = [];
    if (candidate.mutualCount > 0) {
      reasons.push(
        candidate.mutualCount === 1
          ? `Followed by ${candidate.mutualFollowers[0]?.displayName ?? "someone you follow"}`
          : `Followed by ${candidate.mutualCount} people you follow`
      );
    } else if (candidate.tagOverlap > 0) {
      reasons.push("Shares your interests");
    } else if (candidate.recentPostAt) {
      const days = Math.floor(
        (Date.now() - candidate.recentPostAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (days <= 7) {
        reasons.push("Active this week");
      }
    }
    if (reasons.length === 0 && candidate.aura > 500) {
      reasons.push("Popular on asocialmedia");
    }
    if (reasons.length === 0) {
      reasons.push("Suggested for you");
    }
    return { ...candidate, reasons, score };
  });

  // Stable sort by score desc, with secondary sort by aura for tie-breaking
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.aura - a.aura;
  });

  return scored;
}

// Diversify: ensure we don't return 4 users who all look the same
// (e.g. all 10k+ aura). Interleave high/medium/low aura buckets.
export function diversifyRanked<T extends { aura: number }>(
  ranked: T[],
  limit: number
): T[] {
  if (ranked.length <= limit) {
    return ranked;
  }

  // Bucket by aura tier
  const buckets: Record<string, T[]> = {
    high: [],
    low: [],
    medium: [],
  };
  for (const item of ranked) {
    if (item.aura >= 1000) {
      buckets.high.push(item);
    } else if (item.aura >= 100) {
      buckets.medium.push(item);
    } else {
      buckets.low.push(item);
    }
  }

  // If any bucket empty, just return top N scored
  if (buckets.high.length === 0 || buckets.medium.length === 0) {
    return ranked.slice(0, limit);
  }

  const result: T[] = [];
  const iterators = [buckets.high, buckets.medium, buckets.low];
  let bucketIdx = 0;
  let attempts = 0;
  while (result.length < limit && attempts < ranked.length * 2) {
    const bucket = iterators[bucketIdx % iterators.length];
    const next = bucket.shift();
    if (next) {
      result.push(next);
    }
    bucketIdx += 1;
    attempts += 1;
    if (iterators.every((b) => b.length === 0)) {
      break;
    }
  }

  // Fill remainder with original rank order if diversification left gaps
  if (result.length < limit) {
    for (const item of ranked) {
      if (result.length >= limit) {
        break;
      }
      if (!result.includes(item)) {
        result.push(item);
      }
    }
  }

  // Preserve original score order for the selected set? Keep diversified order
  // as it's more interesting, but ensure we didn't lose high scorers
  return result;
}

export function buildViewerInterests(
  followedIds: string[],
  ownTags: string[],
  likedTags: string[]
): ViewerInterests {
  const allTags = [...ownTags, ...likedTags];
  const tagFrequency = new Map<string, number>();
  for (const tag of allTags) {
    tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1);
  }
  // Top 10 most frequent tags
  const topTags = new Set(
    [...tagFrequency.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag)
  );
  return {
    followedIds: new Set(followedIds),
    tagFrequency,
    topTags,
  };
}

// Taste-profile construction for the For-You feed. Turns a user's recent
// positive engagement into normalized per-author and per-topic affinities.
// Pure: callers fetch the raw signals (votes/bookmarks/comments joined to
// posts) and inject them here, which keeps this unit-testable.

export type ProfileSignalKind =
  | "amplify"
  | "bookmark"
  | "comment"
  | "commentVote";

export interface ProfileSignal {
  authorId: string;
  kind: ProfileSignalKind;
  tags: string[];
}

export interface UserProfile {
  authorWeights: Record<string, number>;
  tagWeights: Record<string, number>;
}

// How strongly each engagement kind signals interest. Bookmarks are the most
// deliberate act; amplifying and commenting weigh the same; voting on someone
// else's comment is the weakest, most indirect signal.
const SIGNAL_WEIGHTS: Record<ProfileSignalKind, number> = {
  amplify: 2,
  bookmark: 3,
  comment: 2,
  commentVote: 1,
};

function addWeight(
  weights: Record<string, number>,
  key: string,
  amount: number
): void {
  weights[key] = (weights[key] ?? 0) + amount;
}

// Scales every weight so the map sums to 1, turning raw counts into shares
// of the user's attention. Prolific users and quiet users become comparable.
function normalize(weights: Record<string, number>): Record<string, number> {
  let total = 0;
  for (const weight of Object.values(weights)) {
    total += weight;
  }
  if (total <= 0) {
    return {};
  }
  const normalized: Record<string, number> = {};
  for (const [key, weight] of Object.entries(weights)) {
    normalized[key] = weight / total;
  }
  return normalized;
}

// Builds the user profile from recent engagement signals (last ~30 days,
// filtered by the caller). Each signal credits its target post's author with
// the full kind weight, and splits that weight evenly across the post's
// distinct tags so heavily-tagged posts do not over-credit any single topic.
export function buildUserProfile(signals: ProfileSignal[]): UserProfile {
  const authorWeights: Record<string, number> = {};
  const tagWeights: Record<string, number> = {};

  for (const signal of signals) {
    if (!signal.authorId) {
      continue;
    }
    const weight = SIGNAL_WEIGHTS[signal.kind];
    addWeight(authorWeights, signal.authorId, weight);

    const distinctTags = [...new Set(signal.tags)].filter(Boolean);
    for (const tag of distinctTags) {
      addWeight(tagWeights, tag, weight / distinctTags.length);
    }
  }

  return {
    authorWeights: normalize(authorWeights),
    tagWeights: normalize(tagWeights),
  };
}

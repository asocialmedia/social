// Taste-profile and user-persona construction for the For-You feed.
// Turns a user's recent positive and negative engagement into normalized per-author,
// per-topic affinities, format preferences, topic clusters, and a 384-dimensional taste vector.

import { globalKnowledgeGraph } from "./knowledge-graph";
import { computeCentroid, EMBEDDING_DIMENSION } from "./vector";

export type ProfileSignalKind =
  | "amplify"
  | "bookmark"
  | "comment"
  | "commentVote"
  | "upvote"
  | "downvote"
  | "hide"
  | "ownPost"
  | "ownGust"
  | "search";

export interface ProfileSignal {
  authorId: string;
  createdAt?: Date;
  embedding?: number[];
  hasAudio?: boolean;
  hasImage?: boolean;
  hasVideo?: boolean;
  kind: ProfileSignalKind;
  tags: string[];
}

// Dynamic topic category is completely open-ended without static enumerations.
export type TopicCategory = string;

export interface UserPersonaSummary {
  dominantTopic: string;
  preferredFormat: "video" | "image" | "audio" | "text" | "balanced";
  topTags: string[];
}

export interface UserProfile {
  authorWeights: Record<string, number>;
  tagWeights: Record<string, number>;
  expandedEntityWeights?: Record<string, number>;
  negativeAuthorWeights?: Record<string, number>;
  negativeTagWeights?: Record<string, number>;
  topicAffinities?: Record<string, number>;
  formatAffinities?: {
    audio: number;
    image: number;
    text: number;
    video: number;
  };
  tasteVector?: number[];
  signalCount?: number;
  summary?: UserPersonaSummary;
}

// Signal weights: bookmarks are deliberate save actions, amplify is public endorsement,
// comments are deep engagement, search is active discovery intent, downvote/hide are negative.
export const SIGNAL_WEIGHTS: Record<ProfileSignalKind, number> = {
  amplify: 2,
  bookmark: 3,
  comment: 2,
  commentVote: 1,
  downvote: -2,
  hide: -3,
  ownGust: 3,
  ownPost: 3.5,
  search: 2.5,
  upvote: 1.5,
};

function addWeight(
  weights: Record<string, number>,
  key: string,
  amount: number
): void {
  weights[key] = (weights[key] ?? 0) + amount;
}

// Scales every weight so the map sums to 1.0, turning counts into distribution shares.
function normalize(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total === 1) {
    return { ...weights };
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

// Dynamically extracts entity frequencies from tags without static categories.
export function classifyTopicCategories(
  tags: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!tags || tags.length === 0) {
    return result;
  }

  for (const raw of tags) {
    const clean = raw.toLowerCase().trim().replace(/^#+/, "");
    if (clean.length >= 2) {
      result[clean] = (result[clean] ?? 0) + 1;
    }
  }
  return result;
}

// Builds the rich user persona from engagement signals.
export function buildUserProfile(
  signals: ProfileSignal[],
  options?: { now?: Date }
): UserProfile {
  const now = options?.now ?? new Date();
  const authorWeights: Record<string, number> = {};
  const tagWeights: Record<string, number> = {};
  const negativeAuthorWeights: Record<string, number> = {};
  const negativeTagWeights: Record<string, number> = {};

  const formatCounts = { audio: 0, image: 0, text: 0, video: 0 };
  const topicCounts: Record<string, number> = {};

  const tasteVectors: number[][] = [];
  const tasteWeights: number[] = [];
  let positiveSignalCount = 0;

  for (const signal of signals) {
    const rawWeight = SIGNAL_WEIGHTS[signal.kind] ?? 1;
    const isNegative = rawWeight < 0;

    // Exponential recency time-decay (7-day half-life for interest evolution)
    let recencyFactor = 1;
    if (signal.createdAt) {
      const ageHours = Math.max(
        0,
        (now.getTime() - signal.createdAt.getTime()) / 3_600_000
      );
      recencyFactor = 0.5 ** (ageHours / (7 * 24));
    }
    const magnitude = Math.abs(rawWeight) * recencyFactor;

    if (isNegative) {
      if (signal.authorId) {
        addWeight(negativeAuthorWeights, signal.authorId, magnitude);
      }
      const distinctTags = [...new Set(signal.tags)].filter(Boolean);
      for (const tag of distinctTags) {
        addWeight(negativeTagWeights, tag, magnitude / distinctTags.length);
      }
      continue;
    }

    positiveSignalCount += 1;

    if (
      signal.authorId &&
      signal.kind !== "ownPost" &&
      signal.kind !== "ownGust"
    ) {
      addWeight(authorWeights, signal.authorId, magnitude);
    }

    const distinctTags = [...new Set(signal.tags)].filter(Boolean);
    for (const tag of distinctTags) {
      addWeight(tagWeights, tag, magnitude / distinctTags.length);
    }

    // Accumulate topic and entity affinities dynamically
    const categories = classifyTopicCategories(distinctTags);
    for (const [cat, count] of Object.entries(categories)) {
      if (count > 0) {
        addWeight(topicCounts, cat, count * magnitude);
      }
    }

    // Accumulate media format preferences
    if (signal.hasVideo) {
      formatCounts.video += magnitude * 1.2;
    } else if (signal.hasAudio) {
      formatCounts.audio += magnitude;
    } else if (signal.hasImage) {
      formatCounts.image += magnitude;
    } else {
      formatCounts.text += magnitude * 0.8;
    }

    // Accumulate taste vector for high-intent signals (bookmark, amplify, comment, upvote)
    if (signal.embedding && signal.embedding.length === EMBEDDING_DIMENSION) {
      tasteVectors.push(signal.embedding);
      tasteWeights.push(magnitude);
    }
  }

  // Format distribution
  const totalFormat =
    formatCounts.video +
    formatCounts.image +
    formatCounts.audio +
    formatCounts.text;
  const formatAffinities =
    totalFormat > 0
      ? {
          audio: formatCounts.audio / totalFormat,
          image: formatCounts.image / totalFormat,
          text: formatCounts.text / totalFormat,
          video: formatCounts.video / totalFormat,
        }
      : { audio: 0.1, image: 0.35, text: 0.25, video: 0.3 };

  // Topic distribution
  const totalTopic = Object.values(topicCounts).reduce((a, b) => a + b, 0);
  const topicAffinities: Record<string, number> = {};
  if (totalTopic > 0) {
    for (const [cat, count] of Object.entries(topicCounts)) {
      topicAffinities[cat] = count / totalTopic;
    }
  }

  // Taste vector centroid
  const tasteVector = computeCentroid(tasteVectors, tasteWeights);

  // Dominant topic & preferred format summary
  let dominantTopic = "general";
  let maxTopicScore = 0;
  for (const [cat, score] of Object.entries(topicAffinities)) {
    if (score > maxTopicScore && score >= 0.15) {
      maxTopicScore = score;
      dominantTopic = cat;
    }
  }

  let preferredFormat: UserPersonaSummary["preferredFormat"] = "balanced";
  if (formatAffinities.video > 0.45) {
    preferredFormat = "video";
  } else if (formatAffinities.image > 0.45) {
    preferredFormat = "image";
  } else if (formatAffinities.text > 0.45) {
    preferredFormat = "text";
  } else if (formatAffinities.audio > 0.4) {
    preferredFormat = "audio";
  }

  const topTags = Object.entries(tagWeights)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  const normalizedTagWeights = normalize(tagWeights);
  const expandedEntityWeights =
    globalKnowledgeGraph.spreadingActivation(normalizedTagWeights);

  return {
    authorWeights: normalize(authorWeights),
    expandedEntityWeights,
    formatAffinities,
    negativeAuthorWeights: normalize(negativeAuthorWeights),
    negativeTagWeights: normalize(negativeTagWeights),
    signalCount: positiveSignalCount,
    summary: {
      dominantTopic,
      preferredFormat,
      topTags,
    },
    tagWeights: normalizedTagWeights,
    tasteVector,
    topicAffinities,
  };
}

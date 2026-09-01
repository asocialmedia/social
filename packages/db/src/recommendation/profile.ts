// Taste-profile and user-persona construction for the For-You feed.
// Turns a user's recent positive and negative engagement into normalized per-author,
// per-topic affinities, format preferences, topic clusters, and a 384-dimensional taste vector.

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
  | "ownGust";

export interface ProfileSignal {
  authorId: string;
  embedding?: number[];
  hasAudio?: boolean;
  hasImage?: boolean;
  hasVideo?: boolean;
  kind: ProfileSignalKind;
  tags: string[];
}

export type TopicCategory =
  | "tech"
  | "anime"
  | "brainrot"
  | "gaming"
  | "ai"
  | "media"
  | "news_culture";

export interface UserPersonaSummary {
  dominantTopic: TopicCategory | "general";
  preferredFormat: "video" | "image" | "audio" | "text" | "balanced";
  topTags: string[];
}

export interface UserProfile {
  authorWeights: Record<string, number>;
  tagWeights: Record<string, number>;
  negativeAuthorWeights?: Record<string, number>;
  negativeTagWeights?: Record<string, number>;
  topicAffinities?: Record<TopicCategory, number>;
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

export const TOPIC_KEYWORDS: Record<TopicCategory, string[]> = {
  ai: [
    "ai",
    "artificialintelligence",
    "chatgpt",
    "gemini",
    "claude",
    "llm",
    "machinelearning",
    "deeplearning",
    "openai",
    "c2pa",
    "diffusion",
    "model",
  ],
  anime: [
    "anime",
    "manga",
    "weeb",
    "otaku",
    "cosplay",
    "vtuber",
    "waifu",
    "jpop",
    "art",
    "drawing",
    "illustration",
    "japan",
  ],
  brainrot: [
    "brainrot",
    "meme",
    "memes",
    "shitpost",
    "shitposting",
    "skibidi",
    "sigma",
    "dank",
    "humor",
    "funny",
    "cat",
    "cats",
    "copypasta",
    "irony",
    "comedy",
  ],
  gaming: [
    "gaming",
    "game",
    "games",
    "steam",
    "playstation",
    "xbox",
    "nintendo",
    "rpg",
    "fps",
    "esports",
    "speedrun",
    "minecraft",
    "pcgaming",
    "gameplay",
  ],
  media: [
    "video",
    "videos",
    "film",
    "cinema",
    "photography",
    "photo",
    "music",
    "audio",
    "podcast",
    "production",
    "edit",
    "vlog",
    "aesthetic",
  ],
  news_culture: [
    "news",
    "politics",
    "culture",
    "world",
    "crypto",
    "bitcoin",
    "economics",
    "finance",
    "science",
    "space",
    "history",
    "philosophy",
  ],
  tech: [
    "tech",
    "technology",
    "programming",
    "coding",
    "developer",
    "dev",
    "software",
    "hardware",
    "linux",
    "homelab",
    "rust",
    "typescript",
    "python",
    "javascript",
    "docker",
    "server",
    "open-source",
    "github",
  ],
};

// Signal weights: bookmarks are deliberate save actions, amplify is public endorsement,
// comments are deep engagement, upvote is passive agreement, downvote/hide are negative.
export const SIGNAL_WEIGHTS: Record<ProfileSignalKind, number> = {
  amplify: 2,
  bookmark: 3,
  comment: 2,
  commentVote: 1,
  downvote: -2,
  hide: -3,
  ownGust: 3,
  ownPost: 3.5,
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

// Classifies a set of tags into predefined topic categories.
export function classifyTopicCategories(
  tags: string[]
): Record<TopicCategory, number> {
  const result: Record<TopicCategory, number> = {
    ai: 0,
    anime: 0,
    brainrot: 0,
    gaming: 0,
    media: 0,
    news_culture: 0,
    tech: 0,
  };
  if (!tags || tags.length === 0) {
    return result;
  }

  const cleanTags = tags.map((t) =>
    t.toLowerCase().replaceAll(/[#_\-\s]/g, "")
  );
  for (const [category, keywords] of Object.entries(TOPIC_KEYWORDS) as [
    TopicCategory,
    string[],
  ][]) {
    for (const tag of cleanTags) {
      if (keywords.some((kw) => tag === kw || tag.includes(kw))) {
        result[category] += 1;
      }
    }
  }
  return result;
}

// Builds the rich user persona from engagement signals.
export function buildUserProfile(signals: ProfileSignal[]): UserProfile {
  const authorWeights: Record<string, number> = {};
  const tagWeights: Record<string, number> = {};
  const negativeAuthorWeights: Record<string, number> = {};
  const negativeTagWeights: Record<string, number> = {};

  const formatCounts = { audio: 0, image: 0, text: 0, video: 0 };
  const topicCounts: Record<TopicCategory, number> = {
    ai: 0,
    anime: 0,
    brainrot: 0,
    gaming: 0,
    media: 0,
    news_culture: 0,
    tech: 0,
  };

  const tasteVectors: number[][] = [];
  const tasteWeights: number[] = [];
  let positiveSignalCount = 0;

  for (const signal of signals) {
    const rawWeight = SIGNAL_WEIGHTS[signal.kind] ?? 1;
    const isNegative = rawWeight < 0;
    const magnitude = Math.abs(rawWeight);

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

    // Accumulate topic category affinities
    const categories = classifyTopicCategories(distinctTags);
    for (const [cat, count] of Object.entries(categories) as [
      TopicCategory,
      number,
    ][]) {
      if (count > 0) {
        topicCounts[cat] += count * magnitude;
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
  const topicAffinities: Record<TopicCategory, number> = {
    ai: 0,
    anime: 0,
    brainrot: 0,
    gaming: 0,
    media: 0,
    news_culture: 0,
    tech: 0,
  };
  if (totalTopic > 0) {
    for (const [cat, count] of Object.entries(topicCounts) as [
      TopicCategory,
      number,
    ][]) {
      topicAffinities[cat] = count / totalTopic;
    }
  }

  // Taste vector centroid
  const tasteVector = computeCentroid(tasteVectors, tasteWeights);

  // Dominant topic & preferred format summary
  let dominantTopic: TopicCategory | "general" = "general";
  let maxTopicScore = 0;
  for (const [cat, score] of Object.entries(topicAffinities) as [
    TopicCategory,
    number,
  ][]) {
    if (score > maxTopicScore && score >= 0.2) {
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

  return {
    authorWeights: normalize(authorWeights),
    formatAffinities,
    negativeAuthorWeights: normalize(negativeAuthorWeights),
    negativeTagWeights: normalize(negativeTagWeights),
    signalCount: positiveSignalCount,
    summary: {
      dominantTopic,
      preferredFormat,
      topTags,
    },
    tagWeights: normalize(tagWeights),
    tasteVector,
    topicAffinities,
  };
}

export {
  createExternalTopicMatcher,
  externalPostTopics,
  externalTopicMatch,
  externalRegionalRelevance,
  externalAiDeclaration,
  mergeTopicWeights,
} from "./post-metadata";

export interface ExternalAuthor {
  id: string;
  source: "bluesky";
  handle: string;
  displayName: string;
  url: string;
  avatarUrl?: string;
  bannerUrl?: string;
  description?: string;
  labels: string[];
  upstreamCounts: { followers?: number; following?: number; posts?: number };
}

export interface TextSegment {
  text: string;
  href?: string;
}

export interface ExternalMedia {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface ExternalPost {
  networkRecommendationToken?: string;
  asm?: {
    amplified: boolean;
    bookmarked: boolean;
    amplifications: number;
    comments: number;
    responses?: number;
  };
  id: string;
  revision: string;
  source: "bluesky";
  url: string;
  author: ExternalAuthor;
  text: string;
  segments: TextSegment[];
  createdAt: string;
  indexedAt: string;
  languages: string[];
  labels: string[];
  selfLabels?: string[];
  tags?: string[];
  facets?: { tags: string[]; links: string[]; mentions: string[] };
  media: ExternalMedia[];
  replyTo?: string;
  replyRoot?: string;
  quote?: ExternalPost;
  unavailableQuote?: boolean;
  externalLink?: {
    url: string;
    title: string;
    description: string;
    thumbnailUrl?: string;
  };
  upstreamCounts: {
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
  };
}

export interface ExternalThread {
  post: ExternalPost | null;
  replies: ExternalPost[];
}

export interface ExternalPage<T> {
  items: T[];
  cursor: string | null;
}

export interface ProtocolCapabilities {
  source: "bluesky";
  profileTabs: readonly ("posts" | "replies" | "media")[];
  publicProfiles: boolean;
  publicFeeds: boolean;
  liveEvents: boolean;
  authenticatedWrites: boolean;
}

export type ProtocolErrorCode =
  | "invalid_input"
  | "unavailable"
  | "restricted"
  | "rate_limited"
  | "invalid_response"
  | "capacity"
  | "cancelled";

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly retryAfterSeconds?: number;
  constructor(
    code: ProtocolErrorCode,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ProtocolDiagnostic {
  operation: string;
  outcome: "success" | "error" | "cache_hit";
  durationMs: number;
  code?: ProtocolErrorCode;
}

export type ProtocolObserver = (diagnostic: ProtocolDiagnostic) => void;

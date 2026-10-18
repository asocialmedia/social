import type { PostData, UserData } from "@asm/db";
import type { ExternalPost, ExternalAuthor } from "@asm/protocols/contracts";
import {
  externalAiDeclaration,
  externalPostTopics,
} from "@asm/protocols/contracts";

import {
  sanitizeEmbedUrl,
  youtubeVideoIdFromUrl,
} from "@/lib/link-embeds/shared";
import { blueskyMediaIsExplicit } from "@/lib/protocols/content-labels";

export type PresentedPost = PostData & { external?: ExternalPost };

// This is a rendering model. Its external tag keeps protocol identities out of native mutations.
export function externalPostView(post: ExternalPost): PresentedPost {
  const aiDeclaration = externalAiDeclaration(post);
  return {
    _count: {
      bookmarks: 0,
      comments: (post.asm?.comments ?? 0) + (post.upstreamCounts?.replies ?? 0),
      responses: post.asm?.responses ?? 0,
      vote: post.upstreamCounts?.likes ?? 0,
    },
    attachments: post.media.map((media) => ({
      ...(aiDeclaration
        ? { aiGenerated: true, aiGeneratedSource: "bluesky-label" as const }
        : {}),
      altText: media.alt,
      hasHls: media.type === "video",
      height: media.height ?? null,
      id: media.url,
      thumbnailKey: media.thumbnailUrl ?? null,
      type: media.type === "video" ? "VIDEO" : "IMAGE",
      width: media.width ?? null,
    })),
    aura: 0,
    bookmarks: [],
    community: null,
    communityId: null,
    communityShare: null,
    content: post.text,
    createdAt: new Date(post.createdAt),
    embedding: [],
    embeddingFingerprint: null,
    embeddingModel: null,
    embeds: post.externalLink
      ? [
          {
            description: post.externalLink.description,
            imageUrl: post.externalLink.thumbnailUrl ?? null,
            siteName: new URL(post.externalLink.url).hostname.replace(
              /^www\./u,
              ""
            ),
            title: post.externalLink.title,
            type: youtubeVideoIdFromUrl(post.externalLink.url)
              ? "youtube"
              : "link",
            url:
              sanitizeEmbedUrl(post.externalLink.url) ?? post.externalLink.url,
            videoId: youtubeVideoIdFromUrl(post.externalLink.url),
          },
        ]
      : null,
    explicitContent: blueskyMediaIsExplicit(post),
    external: post,
    externalParent: null,
    externalParentId: null,
    hnStoryShare: undefined,
    id: post.id,
    isGust: false,
    lastAwardedShareCount: 0,
    lastAwardedViewCount: 0,
    mentions: [],
    moderated: false,
    parentPost: null,
    parentPostId: null,
    rootPostId: null,
    semanticTags: externalPostTopics(post),
    tags: [],
    threadTopId: null,
    trendingScore: 0,
    user: externalAuthorView(post.author),
    userId: post.author.id,
    viewCount: 0,
    vote: [],
  };
}

export function externalAuthorView(author: ExternalAuthor): UserData {
  return {
    aura: 0,
    avatarUrl: author.avatarUrl ?? null,
    badge: null,
    badges: [],
    bannerUrl: author.bannerUrl ?? null,
    bio: author.description ?? null,
    communityMemberships: [],
    createdAt: new Date(0),
    customDomain: null,
    displayName: author.displayName,
    displayUsername: null,
    followers: [],
    githubUsername: null,
    id: author.id,
    linkedinUsername: null,
    redditUsername: null,
    twitterUsername: null,
    username: author.handle,
  };
}

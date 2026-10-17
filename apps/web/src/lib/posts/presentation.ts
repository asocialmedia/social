import type { PostData, UserData } from "@asm/db";
import type { ExternalPost, ExternalAuthor } from "@asm/protocols/contracts";

export type PresentedPost = PostData & { external?: ExternalPost };

// This is a rendering model. Its external tag keeps protocol identities out of native mutations.
export function externalPostView(post: ExternalPost): PresentedPost {
  return {
    _count: {
      bookmarks: 0,
      comments: post.asm?.comments ?? 0,
      responses: post.asm?.responses ?? 0,
      vote: 0,
    },
    attachments: post.media.map((media) => ({
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
            title: post.externalLink.title,
            type: "link",
            url: post.externalLink.url,
          },
        ]
      : null,
    explicitContent: false,
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
    semanticTags: [],
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

import type { ExternalPost } from "@asm/protocols/contracts";

import type { FeedPost } from "./feed-types";

export function externalPostView(post: ExternalPost): FeedPost {
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
      height: media.height,
      id: media.url,
      thumbnailKey: media.thumbnailUrl,
      type: media.type === "video" ? "VIDEO" : "IMAGE",
      width: media.width,
    })),
    content: post.text,
    createdAt: post.createdAt,
    embeds: post.externalLink
      ? JSON.stringify([
          {
            description: post.externalLink.description,
            imageUrl: post.externalLink.thumbnailUrl,
            title: post.externalLink.title,
            type: "link",
            url: post.externalLink.url,
          },
        ])
      : null,
    external: post,
    id: post.id,
    user: {
      avatarUrl: post.author.avatarUrl ?? null,
      displayName: post.author.displayName,
      id: post.author.id,
      username: post.author.handle,
    },
    userId: post.author.id,
  };
}

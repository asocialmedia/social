import type { ExternalPost } from "@asm/protocols/contracts";

import type { FeedPost } from "./feed-types";

const EXPLICIT_LABELS = new Set([
  "adult",
  "corpse",
  "gore",
  "graphic-media",
  "nsfw",
  "nudity",
  "porn",
  "pornography",
  "r18",
  "r-18",
  "self-harm",
  "sexual",
  "torture",
  "violence",
  "xxx",
]);

const EXPLICIT_TAGS = new Set([
  "18+",
  "adult",
  "ecchi",
  "erotic",
  "gore",
  "hentai",
  "lewd",
  "nsfw",
  "nsfwart",
  "porn",
  "pornography",
  "r18",
  "r-18",
  "sex",
  "sexual",
  "xxx",
]);

const EXPLICIT_HASHTAG_REGEX =
  /#(?:18\+|adult|ecchi|erotic|gore|hentai|lewd|nsfw|porn|r18|r-18|xxx)\b/i;

export function externalPostView(post: ExternalPost): FeedPost {
  return {
    _count: {
      bookmarks: 0,
      comments: (post.asm?.comments ?? 0) + (post.upstreamCounts?.replies ?? 0),
      responses: post.asm?.responses ?? 0,
      vote: post.upstreamCounts?.likes ?? 0,
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
    explicitContent:
      [post.labels, post.selfLabels, post.author.labels].some((labels) =>
        labels?.some((label) => EXPLICIT_LABELS.has(label.toLowerCase()))
      ) ||
      [...(post.tags ?? []), ...(post.facets?.tags ?? [])].some((tag) =>
        EXPLICIT_TAGS.has(tag.toLowerCase().replace(/^#+/u, ""))
      ) ||
      Boolean(post.text && EXPLICIT_HASHTAG_REGEX.test(post.text)),
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

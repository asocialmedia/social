import { siteConfig } from "@asm/ui/meta/site";

import { absoluteUrl } from "./seo";

interface SocialPostSchemaInput {
  author: { name: string; url: string; username: string };
  commentCount: number;
  content: string;
  createdAt: Date;
  description: string;
  headline: string;
  media: { id: string; type: string }[];
  url: string;
  viewCount: number;
}

export function buildSocialPostJsonLd(post: SocialPostSchemaInput) {
  const images = post.media
    .filter((media) => media.type.toLowerCase().startsWith("image"))
    .map((media) => absoluteUrl(`/api/media/${media.id}`));
  const videos = post.media
    .filter((media) => media.type === "VIDEO")
    .map((media) => ({
      "@type": "VideoObject",
      contentUrl: absoluteUrl(`/api/media/${media.id}`),
      name: post.headline,
      thumbnailUrl: absoluteUrl(`/api/media/${media.id}?thumb=1`),
      uploadDate: post.createdAt.toISOString(),
    }));
  return {
    "@context": "https://schema.org",
    "@type": "SocialMediaPosting",
    author: {
      "@type": "Person",
      alternateName: `@${post.author.username}`,
      name: post.author.name,
      url: post.author.url,
    },
    commentCount: post.commentCount,
    datePublished: post.createdAt.toISOString(),
    description: post.description,
    headline: post.headline,
    ...(post.content.trim() ? { text: post.content } : {}),
    ...(images.length ? { image: images } : {}),
    ...(videos.length ? { video: videos } : {}),
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: Math.max(0, post.commentCount),
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/ViewAction",
        userInteractionCount: Math.max(0, post.viewCount),
      },
    ],
    mainEntityOfPage: { "@id": post.url, "@type": "WebPage" },
    publisher: { "@id": `${siteConfig.url}/#organization` },
    url: post.url,
  };
}

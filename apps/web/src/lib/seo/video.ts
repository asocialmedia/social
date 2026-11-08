import { siteConfig } from "@asm/ui/meta/site";

export function videoWatchPath(postId: string, mediaId: string) {
  return `/watch/${encodeURIComponent(postId)}/${encodeURIComponent(mediaId)}`;
}

export function videoWatchUrl(postId: string, mediaId: string) {
  return `${siteConfig.url}${videoWatchPath(postId, mediaId)}`;
}

export function buildVideoJsonLd(input: {
  postId: string;
  mediaId: string;
  title: string;
  description: string;
  createdAt: Date;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    contentUrl: `${siteConfig.url}/api/media/${input.mediaId}`,
    description: input.description,
    embedUrl: videoWatchUrl(input.postId, input.mediaId),
    mainEntityOfPage: videoWatchUrl(input.postId, input.mediaId),
    name: input.title,
    thumbnailUrl: `${siteConfig.url}/api/media/${input.mediaId}?thumb=1`,
    uploadDate: input.createdAt.toISOString(),
  };
}

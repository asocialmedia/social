// Media + view helpers for post cards, ported from web
// (lib/utils/image-url.ts media fns). Single-image-per-tile selection (no
// srcset on native): feed singles use the lg rung, grids the md rung, GIFs
// bypass variants to preserve animation, videos use poster + progressive MP4.

import type { FeedMedia } from "./feed-types";

export function mediaVariantUrl(
  apiBase: string,
  mediaId: string,
  variant: string
): string {
  return `${apiBase.replace(/\/+$/, "")}/api/media/${mediaId}/v/${variant}`;
}

export function mediaImageUrl(apiBase: string, media: FeedMedia): string {
  if (media.mimeType === "image/gif") {
    return `${apiBase.replace(/\/+$/, "")}/api/media/${media.id}`;
  }
  return mediaVariantUrl(apiBase, media.id, "lg-webp.webp");
}

export function mediaGridImageUrl(apiBase: string, media: FeedMedia): string {
  if (media.mimeType === "image/gif") {
    return `${apiBase.replace(/\/+$/, "")}/api/media/${media.id}`;
  }
  return mediaVariantUrl(apiBase, media.id, "md-webp.webp");
}

export function mediaPosterUrl(apiBase: string, mediaId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/api/media/${mediaId}?thumb=1`;
}

export function mediaVideoUrl(apiBase: string, mediaId: string): string {
  return mediaVariantUrl(apiBase, mediaId, "mp4-h264.mp4");
}

// Audio streams the published original like web's AudioPreview (no
// derivative ladder for audio).
export function mediaAudioUrl(apiBase: string, mediaId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/api/media/${mediaId}`;
}

const CLEAN_NAME_PATTERN = /^(?<prefix>\d+[-_])?[a-f0-9-]+[-_]?/;

// Display filename for the audio row, mirroring web formatFileName. The
// parameter is optional (unlike web's required one): the repo's auto-fixer
// strips explicit `undefined` arguments, so a zero-arg call is the only
// spelling that survives `bun run check`.
export function formatFileName(
  key?: string | null,
  fallback = "Unknown file"
): string {
  if (!key) {
    return fallback;
  }
  const fileName = key.split("/").pop() || fallback;
  const cleanName = fileName.replace(CLEAN_NAME_PATTERN, "");
  try {
    return decodeURIComponent(cleanName);
  } catch {
    return cleanName;
  }
}

export function isVideoMedia(media: FeedMedia): boolean {
  return media.type === "VIDEO";
}

export function isAudioMedia(media: FeedMedia): boolean {
  return media.type === "AUDIO";
}

export function isGifMedia(media: FeedMedia): boolean {
  return media.mimeType === "image/gif";
}

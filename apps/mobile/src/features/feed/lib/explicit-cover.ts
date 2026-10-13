import type { FeedMedia } from "./feed-types";
import {
  isAudioMedia,
  isVideoMedia,
  mediaPosterUrl,
  mediaVariantUrl,
} from "./media-url";

export function explicitCoverUrl(
  apiBase: string,
  media: FeedMedia
): string | null {
  if (isAudioMedia(media)) {
    return null;
  }
  return isVideoMedia(media)
    ? mediaPosterUrl(apiBase, media.id)
    : mediaVariantUrl(apiBase, media.id, "md-webp.webp");
}

export function canBlurExplicitCover(source: {
  isAnimated?: boolean;
  mediaType: string | null;
}): boolean {
  return (
    source.isAnimated !== true &&
    !source.mediaType?.toLowerCase().includes("gif")
  );
}

export function supportsExplicitBlur(
  os: string,
  version: string | number
): boolean {
  return (
    os === "ios" ||
    os === "web" ||
    (os === "android" && typeof version === "number" && version >= 31)
  );
}

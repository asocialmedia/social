// Stored avatar/banner URLs look like `{endpoint}/{bucket}/avatars/{userId}/...`
// or `{endpoint}/{bucket}/banners/{userId}/...` (sometimes with encoded `%2F` separators).
// Object storage buckets are private — content is only reachable through the app proxy routes,
// so rewrite these URLs to their app-relative proxy paths at render time.
// The userId must be followed by another path segment (the object filename):
// `avatars/{userId}/{file}`. Static default avatars (`/avatars/default-N.png`)
// are plain public assets and must NOT be rewritten.
const ASMOB_AVATAR_URL_RE =
  /(?:^|\/)(?<kind>avatars|banners)\/(?<userId>[^/?#]+)\/[^/?#]+/;

function rewriteAsmobUrl(rawUrl: string): string {
  if (!rawUrl) {
    return "";
  }

  // Handle both unencoded '/' and encoded '%2F' separators in storage URLs
  let decoded = rawUrl;
  try {
    decoded = decodeURIComponent(rawUrl);
  } catch {
    // Keep rawUrl if decoding fails
  }

  const match = decoded.match(ASMOB_AVATAR_URL_RE);
  if (!match?.groups) {
    return rawUrl;
  }
  const { kind, userId } = match.groups;
  // Proxy responses cache for a year; a legacy URL's own path is a stable
  // per-object cache buster so replaced legacy uploads never render stale.
  const file =
    decoded
      .slice(match.index ?? 0)
      .split("/")
      .pop() ?? "";
  return kind === "avatars"
    ? `/api/users/avatar/${userId}/image?v=${file}`
    : `/api/users/banner/${userId}/image?v=${file}`;
}

export const DEFAULT_AVATARS = [
  "/avatars/default-1.png",
  "/avatars/default-2.png",
] as const;

export function getDefaultAvatar(seed?: string | null): string {
  if (!seed) {
    return DEFAULT_AVATARS[0];
  }
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) {
    sum += (seed.codePointAt(i) ?? 0) * (i + 1);
  }
  const index = sum % DEFAULT_AVATARS.length;
  return DEFAULT_AVATARS[index];
}

const DEFAULT_AVATAR_RE = /\/avatars\/(?<file>default-[12]\.png)(?:[?#]|$)/i;
const PROXY_USER_IMAGE_RE =
  /(?:^|\/)api\/users\/(?<kind>avatar|banner)\/(?<userId>[^/?#]+)\/image(?:\?(?<query>[^#]*))?/i;

export function getSecureImageUrl(rawUrl: string): string {
  if (!rawUrl) {
    return "";
  }

  // 1. Normalize any default avatar path or absolute URL (e.g. http://localhost:3000/avatars/default-1.png,
  // http://localhost:3000/avatars/default-2.png, /avatars/default-1.png) to a clean relative static asset path.
  const defaultAvatarMatch = rawUrl.match(DEFAULT_AVATAR_RE);
  if (defaultAvatarMatch?.groups?.file) {
    return `/avatars/${defaultAvatarMatch.groups.file}`;
  }

  // 2. Normalize full app proxy URLs to relative proxy paths (e.g. https://domain.com/api/users/avatar/... -> /api/users/avatar/...)
  const proxyMatch = rawUrl.match(PROXY_USER_IMAGE_RE);
  if (proxyMatch?.groups) {
    const { kind, userId, query } = proxyMatch.groups;
    return `/api/users/${kind}/${userId}/image${query ? `?${query}` : ""}`;
  }

  // 3. Route object-storage avatar/banner URLs through the app proxy so content
  // is never fetched directly from the (private) buckets.
  const rewritten = rewriteAsmobUrl(rawUrl);
  if (rewritten !== rawUrl || rewritten.startsWith("/")) {
    return rewritten;
  }

  // 4. For external images, ensure HTTPS in production.
  // Avoid client/server branches (e.g. window.location checks) during render to prevent SSR hydration mismatches.
  if (process.env.NODE_ENV === "production" && rawUrl.startsWith("http://")) {
    return rawUrl.replace("http://", "https://");
  }

  return rawUrl;
}

// Converts a stored object-storage avatar/banner URL to its app proxy path, or
// returns the input unchanged when it is not an object-storage URL.
export function toAppProxyUrl(url: string | null | undefined): string {
  if (!url) {
    return "";
  }
  const defaultAvatarMatch = url.match(DEFAULT_AVATAR_RE);
  if (defaultAvatarMatch?.groups?.file) {
    return `/avatars/${defaultAvatarMatch.groups.file}`;
  }
  const proxyMatch = url.match(PROXY_USER_IMAGE_RE);
  if (proxyMatch?.groups) {
    const { kind, userId, query } = proxyMatch.groups;
    return `/api/users/${kind}/${userId}/image${query ? `?${query}` : ""}`;
  }
  return rewriteAsmobUrl(url);
}

// App proxy URL for a media object. Images request the 800px WebP feed
// derivative (the variant route falls back to the original for legacy rows
// and animated GIFs); videos always request the poster URL (?thumb=1) so
// image callers receive a frame instead of multi-megabyte video streams.
export function getMediaProxyUrl(media: {
  id: string;
  type?: string;
  mimeType?: string;
  thumbnailKey?: string | null;
}): string {
  if (media.type === "VIDEO") {
    return `/api/media/${media.id}?thumb=1`;
  }
  return getMediaImageUrl(media, "md-webp.webp");
}

// Display URL for a raster image at a chosen derivative size (e.g.
// lg-webp.webp, orig-img-webp.webp). The variant route falls back to the
// published original whenever the derivative does not exist - small sources
// never produce larger ladder rungs - so any size request is safe. Animated
// GIFs bypass variants entirely so their animation survives.
export function getMediaImageUrl(
  media: { id: string; mimeType?: string | null },
  variant: string
): string {
  if (media.mimeType === "image/gif") {
    return `/api/media/${media.id}`;
  }
  return getMediaVariantUrl(media.id, variant);
}

// Optimized derivative URL. The serving route falls back to the published
// original when the derivative does not exist, so this is always safe.
export function getMediaVariantUrl(mediaId: string, variant: string): string {
  return `/api/media/${mediaId}/v/${variant}`;
}

// Playback URL for video: prefers the pipeline's progressive MP4 derivative
// (H.264 + AAC faststart, metadata-stripped). The variant route falls back
// to the published original when no MP4 exists (long-form sources that only
// got an HLS ladder), so the URL is always playable-safe for uploads whose
// original was browser-compatible in the first place.
export function getMediaVideoUrl(mediaId: string): string {
  return getMediaVariantUrl(mediaId, "mp4-h264.mp4");
}

// srcset for responsive delivery: the browser picks the smallest rung that
// covers its viewport width × devicePixelRatio. Each variant URL is safe on
// its own (fallback to the original for small sources), so listing every
// ladder rung is always correct even before derivatives exist.
const IMAGE_SRCSET_VARIANTS: readonly [string, number][] = [
  ["thumb-webp.webp", 320],
  ["sm-webp.webp", 640],
  ["md-webp.webp", 800],
  ["lg-webp.webp", 1200],
];

export function getMediaImageSrcSet(media: {
  id: string;
  mimeType?: string | null;
}): string | undefined {
  if (media.mimeType === "image/gif") {
    return undefined;
  }
  return IMAGE_SRCSET_VARIANTS.map(
    ([variant, width]) => `${getMediaVariantUrl(media.id, variant)} ${width}w`
  ).join(", ");
}

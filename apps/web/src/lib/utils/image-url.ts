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
  return kind === "avatars"
    ? `/api/users/avatar/${userId}/image`
    : `/api/users/banner/${userId}/image`;
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

export function getSecureImageUrl(rawUrl: string): string {
  if (!rawUrl) {
    return "";
  }

  // 1. Normalize any default avatar path or absolute URL (e.g. https://social.localhost/avatars/default-1.png,
  // http://localhost:3000/avatars/default-2.png, /avatars/default-1.png) to a clean relative static asset path.
  const defaultAvatarMatch = rawUrl.match(DEFAULT_AVATAR_RE);
  if (defaultAvatarMatch?.groups?.file) {
    return `/avatars/${defaultAvatarMatch.groups.file}`;
  }

  // 2. Route object-storage avatar/banner URLs through the app proxy so content
  // is never fetched directly from the (private) buckets.
  const rewritten = rewriteAsmobUrl(rawUrl);
  if (rewritten !== rawUrl || rewritten.startsWith("/")) {
    return rewritten;
  }

  // 3. For external images, ensure HTTPS in production.
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
  return rewriteAsmobUrl(url);
}

// App proxy URL for a media object. Videos always request the thumbnail URL
// (?thumb=1) so image callers receive a poster image/placeholder instead of
// downloading multi-megabyte video streams.
export function getMediaProxyUrl(media: {
  id: string;
  type?: string;
  thumbnailKey?: string | null;
}): string {
  const thumbnail = media.type === "VIDEO" ? "?thumb=1" : "";
  return `/api/media/${media.id}${thumbnail}`;
}

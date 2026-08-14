// Stored avatar/banner URLs look like `{endpoint}/{bucket}/avatars/{userId}/...`
// or `{endpoint}/{bucket}/banners/{userId}/...` (sometimes with encoded `%2F` separators).
// Object storage buckets are private — content is only reachable through the app proxy routes,
// so rewrite these URLs to their app-relative proxy paths at render time.
const ASMOB_AVATAR_URL_RE =
  /(?:^|\/)(?<kind>avatars|banners)\/(?<userId>[^/?#]+)/;

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

export function getSecureImageUrl(rawUrl: string): string {
  if (!rawUrl) {
    return "";
  }

  // 1. Route object-storage avatar/banner URLs through the app proxy so content
  // is never fetched directly from the (private) buckets.
  const rewritten = rewriteAsmobUrl(rawUrl);
  if (rewritten !== rawUrl || rewritten.startsWith("/")) {
    return rewritten;
  }

  // 2. For external images, ensure HTTPS in production.
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
  return rewriteAsmobUrl(url);
}

// App proxy URL for a media object. Videos that have a stored 2s thumbnail
// return the thumbnail URL (?thumb=1) so callers can show a real poster
// instead of downloading the clip just to paint a preview frame.
export function getMediaProxyUrl(media: {
  id: string;
  type?: string;
  thumbnailKey?: string | null;
}): string {
  const thumbnail =
    media.type === "VIDEO" && media.thumbnailKey ? "?thumb=1" : "";
  return `/api/media/${media.id}${thumbnail}`;
}

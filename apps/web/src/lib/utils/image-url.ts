// Stored avatar/banner URLs look like `{endpoint}/{bucket}/avatars/{userId}/...`
// or `{endpoint}/{bucket}/banners/{userId}/...`. Object storage buckets are
// private — content is only reachable through the app proxy routes, so rewrite
// these URLs to their app-relative proxy paths at render time.
const ASMOB_AVATAR_URL_RE =
  /^https?:\/\/[^/]+\/[^/]+\/(?<kind>avatars|banners)\/(?<userId>[^/]+)\//;

function rewriteAsmobUrl(url: string): string {
  const match = url.match(ASMOB_AVATAR_URL_RE);
  if (!match?.groups) {
    return url;
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

  let url = rawUrl;

  // If the client is viewing over HTTPS, ensure images don't trigger mixed content
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    url.startsWith("http://")
  ) {
    url = url.replace("http://", "https://");
  }

  if (process.env.NODE_ENV === "production" && url.startsWith("http://")) {
    url = url.replace("http://", "https://");
  }

  // Route object-storage avatar/banner URLs through the app proxy so content
  // is never fetched directly from the (private) buckets.
  return rewriteAsmobUrl(url);
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

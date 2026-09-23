// Native route helpers for the post detail + media screens.
// Mirrors web lib/posts/post-url short-id behavior: native routes accept
// either the full id or the 8-char short prefix, and always link with the
// short form (/posts/<shortId> + /media/<index>).

export function getShortPostId(id: string): string {
  if (!id) {
    return "";
  }
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function getPostDetailPath(post: { id: string }): string {
  return `/posts/${getShortPostId(post.id)}` as const;
}

export function getPostMediaDetailPath(
  post: { id: string },
  index: number
): string {
  return `/posts/${getShortPostId(post.id)}/media/${index}` as const;
}

// The [index] segment must be a strictly decimal non-negative integer, like
// web's INDEX_SEGMENT_PATTERN, so suffixes like "3abc" never resolve.
export function parseMediaIndexParam(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

import { getPostSlug } from "./post-url";

// Post ids are time-sortable (cuid), so the 8-char short id is a timestamp
// prefix: two posts created in the same millisecond produce the SAME short id.
// The prefix lookup therefore has to tolerate more than one match and pick the
// intended post, instead of 404ing whenever a prefix is ambiguous (which it
// always is for a same-millisecond batch).
export interface PostMatchCandidate {
  attachments?: { id: string }[] | null;
  content: string;
  id: string;
}

export interface PostMatchIdentity {
  // The media row being requested (media-page URLs), if known.
  mediaId?: string;
  // The content slug from the requested URL, if present.
  slug?: string;
}

// The most candidates to inspect when resolving an ambiguous prefix. Bounded so
// a pathological prefix cannot pull an unbounded slice of the posts table.
export const POST_MATCH_CANDIDATE_LIMIT = 20;

// Picks the post a short-id request meant. Returns null when the choice is
// genuinely ambiguous, so the caller 404s rather than serving the wrong post.
export function selectPostMatch<T extends PostMatchCandidate>(
  matches: readonly T[],
  identity: PostMatchIdentity = {}
): T | null {
  const [only] = matches;
  if (matches.length <= 1) {
    return only ?? null;
  }

  let candidates = [...matches];

  // The content slug is derived from the post's own text, so it identifies the
  // intended post among same-millisecond siblings as long as the request
  // carried one.
  if (identity.slug) {
    const bySlug = candidates.filter(
      (post) => getPostSlug(post.content) === identity.slug
    );
    if (bySlug.length > 0) {
      candidates = bySlug;
    }
  }

  // A media-page request names the media row, which belongs to exactly one post.
  if (identity.mediaId) {
    const byMedia = candidates.filter((post) =>
      post.attachments?.some((attachment) => attachment.id === identity.mediaId)
    );
    if (byMedia.length > 0) {
      candidates = byMedia;
    }
  }

  const [resolved] = candidates;
  return candidates.length === 1 && resolved ? resolved : null;
}

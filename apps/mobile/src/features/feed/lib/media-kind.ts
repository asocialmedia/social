// Small pure predicates over feed media, kept out of the RN components so they
// unit-test on Node (same convention as feed-types.ts).

export interface MediaLike {
  type?: string | null;
}

export interface PostLike {
  attachments?: MediaLike[] | null;
}

export function isVideoMediaType(type: string | null | undefined): boolean {
  return type === "VIDEO";
}

// Used when nominating the single autoplay owner: a post with no video must
// never take the slot, or a text post at the top of the viewport would blank
// out playback for the video just below it.
export function hasVideoAttachment(post: PostLike): boolean {
  return (post.attachments ?? []).some((media) =>
    isVideoMediaType(media?.type)
  );
}

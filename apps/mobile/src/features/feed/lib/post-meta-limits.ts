// Tag/mention caps for the post metadata editor, ported from web's
// gust-meta-pickers.tsx (MAX_TAGS / MAX_MENTIONS = 5 with the same toast
// copy). Pure helpers so the rules can be unit tested; the dialog consumes
// them. Self-mentions are dropped like web's useUpdateMentionsMutation:
// the server strips them (aura-farming guard), so the client never sends or
// caches the current user as a mention.
export const MAX_POST_TAGS = 5;
export const MAX_POST_MENTIONS = 5;

export function tagLimitReached(tags: readonly string[]): boolean {
  return tags.length >= MAX_POST_TAGS;
}

export function mentionLimitReached(
  mentions: readonly { id: string }[]
): boolean {
  return mentions.length >= MAX_POST_MENTIONS;
}

export function filterSelfMentionIds(
  ids: readonly string[],
  currentUserId?: string | null
): string[] {
  if (!currentUserId) {
    return [...ids];
  }
  return ids.filter((id) => id !== currentUserId);
}

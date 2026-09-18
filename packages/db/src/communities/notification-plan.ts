// Pure batching rule for community-post notifications. Kept dependency-free so
// it is unit-testable without loading Prisma or Redis through the service barre.

// Splits the subscribers of a community into the two halves the fan-out treats
// differently: those with an unread COMMUNITY_POST row to fold into (increment
// in place) and those who need a fresh row. Folding keeps a busy community to
// one notification per reader instead of one per post.
export function planCommunityNotification(
  recipientIds: string[],
  unreadRecipientIds: string[]
): { fold: string[]; fresh: string[] } {
  const alreadyUnread = new Set(unreadRecipientIds);
  const fold: string[] = [];
  const fresh: string[] = [];
  for (const recipientId of recipientIds) {
    if (alreadyUnread.has(recipientId)) {
      fold.push(recipientId);
    } else {
      fresh.push(recipientId);
    }
  }
  return { fold, fresh };
}

// Pure batching rule for a notification fan-out, kept dependency-free so it is
// unit-testable without loading Prisma or Redis through the service barrels.
//
// One rule for every fan-out that repeats: a community post, a message in a den.
// Given the audience and the recipients who already have an unread row for the
// same subject, it splits them into the two halves the writer treats
// differently - those whose existing row is incremented in place (fold) and
// those who need a fresh row (fresh). Folding is what keeps a busy subject to
// one notification per reader instead of one per event.
export function planFoldedNotification(
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

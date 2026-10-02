import type { PrismaTransaction } from "../prisma";

// The notification a member gets when their den membership ends without their
// consent.
//
// Two events, one row type, and the conversation is what tells them apart:
//
//   - removed. The den is still standing, so the row points at it and the copy
//     can name it: "Alex removed you from Study group".
//   - dissolved. The den is gone, the foreign key would cascade the
//     notification away with it, and the copy says "a den" because there is
//     nothing left to name.
//
// Why either is worth a push, when the realtime announcement already covers the
// reader who is connected:
//
//   The announcement is delivered on the den's own channel, so it reaches exactly
//   the members who currently have that den open. Every other member finds out
//   from the conversation list, which drops the den on its next poll and says
//   nothing about why. That is a silent, irreversible loss of history: the
//   conversation row owns the messages, the key wraps and every member's read
//   watermark, so a den that is deleted is not something the reader can get
//   back by looking harder. A member who was pushed a message from a den and then
//   never hears that the den itself is gone has been told the least interesting
//   thing and not the thing that mattered.
//
// What is deliberately NOT here: leaving. The person who left knows, and a
// notification telling them what they just did is noise.
//
// Folding does not apply, and cannot: there is at most one of these per member
// per event, and the recipient is by definition no longer in the conversation, so
// there is no roster row left to fold a second one into. `count` is therefore
// always 1 and never means anything but 1 for this type.

export type DenMembershipEndedReason = "dissolved" | "removed";

export interface DenMembershipEndedNotification {
  id: string;
  recipientId: string;
}

// Writes the rows inside the caller's transaction, so a membership change that
// rolls back cannot leave a notification claiming a removal that never happened.
// The caller enqueues the returned ids after the commit; see the note in
// `den-service.ts` about why the split matters.
export async function createDenMembershipEndedNotifications(
  transaction: PrismaTransaction,
  input: {
    actorId: string;
    conversationId: string;
    recipientIds: readonly string[];
    reason: DenMembershipEndedReason;
  }
): Promise<DenMembershipEndedNotification[]> {
  // The actor is filtered out rather than trusted: a self-service leave that
  // dissolves the den has exactly one member, and telling somebody they were
  // removed from a den they just left alone is a lie in the one direction that
  // would be noticed.
  const recipients = [...new Set(input.recipientIds)].filter(
    (recipientId) => recipientId !== input.actorId
  );
  if (recipients.length === 0) {
    return [];
  }
  const conversationId =
    input.reason === "removed" ? input.conversationId : null;
  const rows = await transaction.orm.public.Notifications.createAll(
    recipients.map((recipientId) => ({
      _type: "DEN_MEMBERSHIP_ENDED" as const,
      conversationId,
      count: 1,
      issuerId: input.actorId,
      recipientId,
    }))
  );
  return rows.map((row) => ({ id: row.id, recipientId: row.recipientId }));
}

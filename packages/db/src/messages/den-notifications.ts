import { and } from "@prisma/orm-postgres/orm-client";

import { planFoldedNotification } from "../notifications/plan";
import { toPrismaDateTime } from "../prisma";
import type { PrismaTransaction } from "../prisma";

// The den message fan-out: who hears that a message landed in a den.
//
// Lives in @asm/db beside the rest of the message layer, and takes the
// transaction rather than opening one, because the rows it writes have to
// commit with the message itself. A notification for a message that rolled back
// is a push about something that does not exist.
//
// What a recipient gets, and what they do not:
//
// - Everyone in the den except the sender. A den's ceiling is 100 members
//   (DEN_LIMITS.membersMax), so the audience is bounded and needs no fan-out cap
//   of its own.
// - A member who has MUTED the den gets nothing. A mute means no badge and no
//   push; the messages still arrive in the thread and over the stream, exactly
//   as the conversation list already forces their per-conversation badge to 0.
//   Letting a den push past a mute would be a way around a preference the user
//   set, so the mute is applied here at the source rather than in a filter
//   downstream.
// - A member who has the den open in another tab is not treated specially. The
//   DM path does not suppress a notification for a reader who is looking at the
//   thread (the unread increment skips only the sender), and inventing that here
//   would make a den behave differently from a DM for no reason a user could
//   name. The unread badge is the signal the app already uses for "you are not
//   here".
//
// Folding. While a recipient's row for this den is unread, a second message
// increments it instead of inserting a new one, so a hundred messages in a busy
// minute is one row carrying a count of a hundred, not a hundred rows to
// dismiss. This is the same fold-vs-fresh split the community-post fan-out
// uses, from the same pure rule. The unread notification counter follows suit:
// only a fresh row produces a `notification-created` job, so a folded message
// does not move the badge either.
//
// The fold relies on the caller having taken the den's row lock first (the send
// path bumps `message_conversations.updatedAt` before calling). Two sends into
// one den therefore serialize, and the second one's read sees the first one's
// row. Without that ordering two sends could each insert a row for the same
// recipient and den; read-time grouping still folds those into one inbox entry,
// so the worst case is a slightly larger count, never a duplicate thread of
// notifications. A member marking the den read does not take that lock, which
// is what the `readSince` fallback in the body is for.
//
// What the row carries: the sender, the den, and a count. Never the message.
// The server only ever holds ciphertext, so there is nothing here to leak, and
// no message id that a future join could attach plaintext to.

export interface DenMessageNotification {
  id: string;
  recipientId: string;
}

// Fans a message out across a den and reports the rows it created. The caller
// enqueues those ids AFTER the transaction commits; see the note at the top of
// the file for why the split matters.
export async function createDenMessageNotifications(
  transaction: PrismaTransaction,
  input: { conversationId: string; senderId: string }
): Promise<DenMessageNotification[]> {
  const members =
    await transaction.orm.public.MessageConversationMembers.select("userId")
      .where((member) =>
        and(
          member.conversationId.eq(input.conversationId),
          // The sender reads their own message; they never notify themselves.
          member.userId.neq(input.senderId),
          // Somebody who left the den cannot read what this would announce - the
          // message is encrypted under the roster's current epoch and they hold no
          // wrap for it - so notifying them would be a push that opens onto
          // nothing, forever, with no way to make it stop.
          member.leftAt.isNull(),
          // A mute suppresses the badge and the push. The message is delivered
          // regardless: the mute is a preference about being interrupted, not
          // about being allowed to read.
          member.mutedAt.isNull()
        )
      )
      .all();
  if (members.length === 0) {
    return [];
  }
  const recipientIds = members.map((member) => member.userId);

  // The rows this den already owes each of them. Scoped to this den and this
  // type, so an unread row about something else can never be folded into a
  // den's count.
  const existing = await transaction.orm.public.Notifications.select(
    "count",
    "id",
    "recipientId"
  )
    .where((notification) =>
      and(
        notification.conversationId.eq(input.conversationId),
        notification.recipientId.in(recipientIds),
        notification._type.eq("DEN_MESSAGE"),
        notification.read.eq(false)
      )
    )
    .all();
  const { fold, fresh } = planFoldedNotification(
    recipientIds,
    existing.map((notification) => notification.recipientId)
  );

  // A member who opened the den between the read above and the write below has
  // a row that is read now. Folding into it would leave this message counted on
  // a row the member has already dismissed, with no badge to show for it, so
  // those recipients are collected here and given a fresh row instead.
  const readSince: string[] = [];
  if (fold.length > 0) {
    const now = toPrismaDateTime(new Date());
    const folding = new Set(fold);
    const folded = existing.filter((notification) =>
      folding.has(notification.recipientId)
    );
    const updated = await Promise.all(
      folded.map(async (notification) => {
        const count = await transaction.orm.public.Notifications.where(
          (candidate) =>
            and(candidate.id.eq(notification.id), candidate.read.eq(false))
        ).updateAndCount({
          // Re-attributed to the newest sender, so the inbox line names whoever
          // wrote last rather than whoever wrote first. `read` is not in the
          // payload: a fold must never put a read badge back.
          count: notification.count + 1,
          createdAt: now,
          issuerId: input.senderId,
        });
        return count === 1 ? null : notification.recipientId;
      })
    );
    for (const recipientId of updated) {
      if (recipientId !== null) {
        readSince.push(recipientId);
      }
    }
  }
  fresh.push(...readSince);

  if (fresh.length === 0) {
    return [];
  }
  const rows = await transaction.orm.public.Notifications.createAll(
    fresh.map((recipientId) => ({
      _type: "DEN_MESSAGE" as const,
      conversationId: input.conversationId,
      count: 1,
      issuerId: input.senderId,
      recipientId,
    }))
  );
  return rows.map((row) => ({ id: row.id, recipientId: row.recipientId }));
}

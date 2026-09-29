// Where the "new messages" rule belongs in a transcript.
//
// The same rule the server counts the unread badge with, applied on the client so
// the divider and the badge cannot disagree: the OLDEST message from the peer that
// is newer than this member's read watermark. Own messages never count (the sender
// has read what they wrote), a deleted row never counts (the server's count skips
// them, and a divider above a message that says it was deleted is a divider above
// nothing), and the comparison is strict because a message AT the watermark is the
// one the watermark was set from.
//
// A null watermark means never read, so the first peer message is the anchor --
// which is what makes a brand-new conversation open on the message that started it
// rather than at the bottom.
//
// Pure so the boundary is testable apart from the transcript and its virtualizer.

export interface UnreadCandidateMessage {
  createdAt: Date | string;
  deletedAt?: Date | string | null;
  id: string;
  senderId: string;
}

// Epoch millis, or null when the value is missing or unparseable. A bad timestamp
// fails safe in both directions: it can neither invent an unread boundary nor
// suppress a real one, because the row is skipped.
function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

// The id of the first unread message, or null when there is nothing unread.
//
// `messages` is the transcript in its rendered order, oldest first. The scan is
// over what is LOADED, which is the newest page when a thread opens: an unread
// boundary older than the loaded window is not found, and the caller simply shows
// no divider rather than scrolling to a row it does not have.
export function firstUnreadMessageId(input: {
  lastReadAt: Date | string | null | undefined;
  messages: readonly UnreadCandidateMessage[];
  myUserId: string;
}): string | null {
  const readAt = toTime(input.lastReadAt);
  for (const message of input.messages) {
    if (message.senderId === input.myUserId) {
      continue;
    }
    if (message.deletedAt) {
      continue;
    }
    const created = toTime(message.createdAt);
    if (created === null) {
      continue;
    }
    if (readAt === null || created > readAt) {
      return message.id;
    }
  }
  return null;
}

// The label above the rule. Exported with the boundary because the two are one
// statement, and a divider with wording of its own is how the two drift.
export const UNREAD_DIVIDER_LABEL = "New messages";

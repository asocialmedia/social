import type { GroupedNotification, NotificationRecord } from "./types";

// Groups notifications that speak about the same subject into a single
// consolidated item with multiple avatars and a count.
//
// Two subjects fold:
//
// - AMPLIFY rows for the same post or eddie (comment).
// - DEN_MESSAGE rows for the same den. A hundred-member den in a busy minute
//   must not hand a member a hundred rows to dismiss, and the den is the only
//   thing those rows have in common.
//
// Everything else (FOLLOW, COMMENT, MENTION, and the rest) passes through as an
// individual item.
//
// The write side folds too: the den fan-out increments one unread row per
// recipient per den rather than inserting a new one, so in the steady state
// there is at most one row to group and this pass is a no-op. It earns its keep
// for the rows a fold cannot reach - a member who read the den and then got
// another message has a read row and an unread one, and the inbox shows the
// pair as the single thing it is.
//
// Safety and ordering guarantees:
// - Position in the feed corresponds to the most recent notification in the group.
// - Issuers are deduplicated by user ID and ordered newest-first.
// - The group is considered unread (read: false) if ANY notification in the group is unread.
// - allNotificationIds preserves all database IDs so batch dismiss can delete every underlying row.
export function groupNotifications<T extends NotificationRecord>(
  notifications: T[]
): GroupedNotification<T>[] {
  const result: GroupedNotification<T>[] = [];
  // Maps groupKey -> index in the result array
  const groupIndexByKey = new Map<string, number>();

  for (const notification of notifications) {
    const groupKey = groupKeyFor(notification);
    if (!groupKey) {
      result.push(single(notification));
      continue;
    }

    const existingIndex = groupIndexByKey.get(groupKey);
    if (existingIndex === undefined) {
      const group = single(notification);
      groupIndexByKey.set(groupKey, result.length);
      result.push(group);
      continue;
    }

    const existingGroup = result[existingIndex];
    if (!existingGroup) {
      // The index cannot dangle: entries are only written alongside a push to
      // the same array, and nothing removes from it. Kept as a guard so a
      // future refactor degrades into "no folding" rather than a crash.
      continue;
    }
    // Collect ID for bulk dismiss
    existingGroup.allNotificationIds.push(notification.id);

    // Deduplicate issuer by ID
    const hasIssuer = existingGroup.issuers.some(
      (user) => user.id === notification.issuer.id
    );
    if (!hasIssuer) {
      existingGroup.issuers.push(notification.issuer);
    }

    // If any notification in the group is unread, the combined item is unread
    if (!notification.read) {
      existingGroup.read = false;
    }

    // Keep the latest createdAt timestamp
    if (toEpoch(notification.createdAt) > toEpoch(existingGroup.createdAt)) {
      existingGroup.createdAt = notification.createdAt;
    }

    // For a den, the count is how many messages the row stands for, so a folded
    // pair reads as the total rather than as the newer row alone: "12 new
    // messages", not "1 new message". AMPLIFY's count is always 1 (its fold is
    // read-time only), so summing leaves it at one per issuer and changes
    // nothing about it.
    if (notification.type === "DEN_MESSAGE") {
      existingGroup.count += notification.count;
    }
  }

  return result;
}

// One notification, unfolded, in the shape a grouped row also has.
function single<T extends NotificationRecord>(
  notification: T
): GroupedNotification<T> {
  return {
    ...notification,
    allNotificationIds: [notification.id],
    issuers: [notification.issuer],
  };
}

// The subject a row folds under, or null when it folds under nothing.
//
// Comment amplifications group by commentId, post amplifications by postId, and
// den messages by the conversation they name. A row that names none of those
// (an amplify with no subject, a den message with no conversation) is its own
// group rather than a group of everything like it.
function groupKeyFor(notification: NotificationRecord): string | null {
  if (notification.type === "AMPLIFY") {
    if (notification.commentId) {
      return `AMPLIFY:comment:${notification.commentId}`;
    }
    if (notification.postId) {
      return `AMPLIFY:post:${notification.postId}`;
    }
    return null;
  }
  if (notification.type === "DEN_MESSAGE") {
    const conversationId =
      notification.conversation?.id ?? notification.conversationId;
    return conversationId ? `DEN_MESSAGE:conversation:${conversationId}` : null;
  }
  return null;
}

// createdAt arrives as a Date from Prisma and as an ISO string over the wire;
// both must compare correctly, so normalize to epoch milliseconds. `>` on a
// Date works but silently fails on strings (lexicographic on ISO is fine, but
// a Date vs string comparison is always false), which is exactly the class of
// bug that hid here before.
function toEpoch(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

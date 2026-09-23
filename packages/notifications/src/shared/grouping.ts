import type { GroupedNotification, NotificationRecord } from "./types";

// Groups multiple AMPLIFY notifications for the same post or eddie (comment)
// into a single consolidated notification item with multiple avatars and count
// indicators.
//
// Non-AMPLIFY notifications (FOLLOW, COMMENT, MENTION, etc.) pass through as
// individual items.
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
  const amplifyGroupMap = new Map<string, number>();

  for (const notification of notifications) {
    if (notification.type !== "AMPLIFY") {
      result.push({
        ...notification,
        allNotificationIds: [notification.id],
        issuers: [notification.issuer],
      });
      continue;
    }

    // Determine the entity key for AMPLIFY notifications.
    // Comment amplifications are grouped by commentId, post amplifications by postId.
    let entityKey: string | null = null;
    if (notification.commentId) {
      entityKey = `comment:${notification.commentId}`;
    } else if (notification.postId) {
      entityKey = `post:${notification.postId}`;
    }

    if (!entityKey) {
      result.push({
        ...notification,
        allNotificationIds: [notification.id],
        issuers: [notification.issuer],
      });
      continue;
    }

    const groupKey = `AMPLIFY:${entityKey}`;
    const existingIndex = amplifyGroupMap.get(groupKey);

    if (existingIndex === undefined) {
      const group: GroupedNotification<T> = {
        ...notification,
        allNotificationIds: [notification.id],
        issuers: [notification.issuer],
      };
      amplifyGroupMap.set(groupKey, result.length);
      result.push(group);
    } else {
      const existingGroup = result[existingIndex];
      if (existingGroup) {
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
        if (
          toEpoch(notification.createdAt) > toEpoch(existingGroup.createdAt)
        ) {
          existingGroup.createdAt = notification.createdAt;
        }
      }
    }
  }

  return result;
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

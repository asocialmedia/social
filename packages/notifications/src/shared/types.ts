// Notification domain types, kept structural and dependency-free so the same
// definitions serve the web app, the native app, and the delivery worker.
//
// These deliberately do not import Prisma: the shared layer is consumed by
// React Native (which must never pull a database client into its bundle) and
// by the worker. A Prisma `Notification` row with `notificationsInclude`
// satisfies `NotificationRecord` structurally, so callers pass their rows
// straight in with no adapter.

export const NOTIFICATION_TYPES = [
  "AMPLIFY",
  "COMMENT",
  "COMMUNITY_POST",
  "DEN_MEMBERSHIP_ENDED",
  "DEN_MESSAGE",
  "FOLLOW",
  "MENTION",
  "MODERATION",
  "PUBLISHED",
  "REPLY",
  "TRANSCRIPTION",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export interface NotificationIssuer {
  avatarUrl: string | null;
  displayName: string | null;
  id: string;
  username: string | null;
}

export interface NotificationCommunity {
  accentColor?: string | null;
  id: string;
  name: string;
  slug: string;
}

export interface NotificationPost {
  community?: { slug: string } | null;
  content?: string | null;
  id: string;
  isGust?: boolean | null;
  parentPostId?: string | null;
}

export interface NotificationComment {
  id: string;
  parent?: { userId: string } | null;
  parentId: string | null;
}

// The conversation a DEN_MESSAGE names, and the conversation a
// DEN_MEMBERSHIP_ENDED row can still point at. The id so a tap can open the den,
// the name so the copy can say which conversation it belongs to. Deliberately
// nothing else. The server only ever holds message ciphertext, so there is no
// message id here to follow and no content that a push could quote.
export interface NotificationConversation {
  id: string;
  name: string | null;
}

export interface NotificationRecord {
  comment: NotificationComment | null;
  commentId: string | null;
  community: NotificationCommunity | null;
  communityId: string | null;
  // Set on DEN_MESSAGE always, and on DEN_MEMBERSHIP_ENDED only for a removal
  // (a dissolve has no den left to point at). Optional because every other
  // type's row carries a null column, and absent on a row that predates the
  // column.
  conversation?: NotificationConversation | null;
  conversationId?: string | null;
  count: number;
  createdAt: Date | string;
  id: string;
  issuer: NotificationIssuer;
  issuerId: string;
  post: NotificationPost | null;
  postId: string | null;
  read: boolean;
  recipientId: string;
  type: NotificationType;
}

// A notification folded together with its siblings: AMPLIFY rows for the same
// post or eddie collapse into one row that carries every underlying id and
// issuer.
export type GroupedNotification<T extends NotificationRecord> = T & {
  // Every database id in the group, so a batch dismiss deletes them all.
  allNotificationIds: string[];
  // Distinct issuers, newest first.
  issuers: NotificationIssuer[];
};

export interface NotificationCountInfo {
  unreadCount: number;
}

export interface NotificationsPage<T extends NotificationRecord> {
  nextCursor: string | null;
  notifications: T[];
}

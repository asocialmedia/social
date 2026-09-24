export const NotificationType = {
  AMPLIFY: "AMPLIFY",
  COMMENT: "COMMENT",
  COMMUNITY_POST: "COMMUNITY_POST",
  FOLLOW: "FOLLOW",
  MENTION: "MENTION",
  MODERATION: "MODERATION",
  PUBLISHED: "PUBLISHED",
  REPLY: "REPLY",
  TRANSCRIPTION: "TRANSCRIPTION",
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationType = {
  AMPLIFY: "AMPLIFY",
  COMMENT: "COMMENT",
  COMMUNITY_POST: "COMMUNITY_POST",
  DEN_MEMBERSHIP_ENDED: "DEN_MEMBERSHIP_ENDED",
  DEN_MESSAGE: "DEN_MESSAGE",
  FOLLOW: "FOLLOW",
  MENTION: "MENTION",
  MODERATION: "MODERATION",
  PUBLISHED: "PUBLISHED",
  REPLY: "REPLY",
  TRANSCRIPTION: "TRANSCRIPTION",
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

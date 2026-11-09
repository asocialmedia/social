// Android notification channels, shared by the delivery worker (which names
// the channel on each FCM message) and the native app (which creates them).
//
// Everything used to arrive on one MAX-importance "default" channel, so every
// like and follow was a heads-up banner with sound. Splitting by what the
// reader is likely to act on lets direct conversation interrupt while social
// signals stay quiet, and gives the reader per-category control in Android
// settings.
//
// Android ignores importance changes on a channel that already exists, so
// these ids are new rather than retuning "default"; the app deletes the old
// channel once these exist.
import type { NotificationType } from "./types";

export type PushChannelId =
  | "asm-messages"
  | "asm-conversation"
  | "asm-social"
  | "asm-community"
  | "asm-account";

// Android's importance levels, named so neither side depends on the other's
// enum. HIGH makes a heads-up banner with sound; DEFAULT sounds without a
// banner; LOW is silent in the shade.
export type PushChannelImportance = "high" | "default" | "low";

export interface PushChannel {
  description: string;
  id: PushChannelId;
  importance: PushChannelImportance;
  name: string;
}

export const PUSH_CHANNELS: readonly PushChannel[] = [
  {
    description: "Direct messages and den messages",
    id: "asm-messages",
    importance: "high",
    name: "Messages",
  },
  {
    description: "Replies, eddies and mentions of you",
    id: "asm-conversation",
    importance: "high",
    name: "Replies and mentions",
  },
  {
    description: "Follows and amplifies",
    id: "asm-social",
    importance: "low",
    name: "Follows and amplifies",
  },
  {
    description: "Community posts, chat and join requests",
    id: "asm-community",
    importance: "default",
    name: "Communities",
  },
  {
    description: "Publishing, transcription and moderation updates",
    id: "asm-account",
    importance: "default",
    name: "Account updates",
  },
];

// The channel the app used before the split, deleted after migration.
export const LEGACY_PUSH_CHANNEL_ID = "default";

const CHANNEL_BY_TYPE: Record<NotificationType, PushChannelId> = {
  AMPLIFY: "asm-social",
  COMMENT: "asm-conversation",
  COMMUNITY_CHAT: "asm-community",
  COMMUNITY_JOIN_APPROVED: "asm-community",
  COMMUNITY_JOIN_DECLINED: "asm-community",
  COMMUNITY_JOIN_REQUEST: "asm-community",
  COMMUNITY_POST: "asm-community",
  DEN_MEMBERSHIP_ENDED: "asm-messages",
  DEN_MESSAGE: "asm-messages",
  FOLLOW: "asm-social",
  MENTION: "asm-conversation",
  MODERATION: "asm-account",
  PUBLISHED: "asm-account",
  REPLY: "asm-conversation",
  TRANSCRIPTION: "asm-account",
};

export function pushChannelForType(type: NotificationType): PushChannelId {
  return CHANNEL_BY_TYPE[type];
}

export function pushChannel(id: PushChannelId): PushChannel {
  const channel = PUSH_CHANNELS.find((candidate) => candidate.id === id);
  if (!channel) {
    throw new Error(`Unknown push channel: ${id}`);
  }
  return channel;
}

import type { CommunityRoleRow } from "@asm/db";

export interface MessageIdentitySummary {
  publicKey: string;
}

export interface MessageSender {
  avatarUrl: string | null;
  badge: string | null;
  badges: readonly string[];
  communityMemberships: CommunityRoleRow[];
  displayName: string;
  id: string;
  username: string;
}

export interface MessageConversationMember {
  conversationId: string;
  lastReadAt: Date | null;
  user: MessageSender & {
    messageIdentity: MessageIdentitySummary | null;
  };
  userId: string;
}

export interface MessageConversationKey {
  conversationId: string;
  createdAt: Date;
  encryptedKey: string;
  id: string;
  iv: string;
  ownerUserId: string;
  ratchetCounter: number;
}

export interface MessageConversationData {
  createdAt: Date;
  id: string;
  keys: MessageConversationKey[];
  members: MessageConversationMember[];
  pairKey: string | null;
  updatedAt: Date;
}

export interface MessageData {
  ciphertext: string;
  conversationId: string;
  createdAt: Date;
  deletedAt: Date | null;
  id: string;
  iv: string;
  ratchetIndex: number;
  sender?: MessageSender | null;
  senderId: string;
}

export interface MessagePage {
  messages: MessageData[];
  previousCursor: string | null;
}

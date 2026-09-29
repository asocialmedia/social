import type { CommunityRoleRow } from "@asm/db";

export interface MessageIdentitySummary {
  publicKey: string;
}

export interface MessageSender {
  // The peer's chosen banner, so a conversation's contact card can show the
  // header image they picked in settings instead of a decorative gradient.
  bannerUrl?: string | null;
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
  // Watermark of the newest message this member confirmed receipt of, and this
  // member's own DM preferences. Both are per-member, so the peer never sees
  // them. mutedAt is a real event timestamp, not a boolean.
  lastDeliveredAt?: Date | null;
  mutedAt?: Date | null;
  themeKey?: string | null;
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
  // Root-key epoch. A member holds one wrap per epoch; older ones stay readable
  // so a reset never costs the peer its history.
  version: number;
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
  // Set when the sender rewrote this message in place. The ratchet index never
  // changes, so receivers re-decrypt the row rather than appending a new one.
  // Null means never edited.
  editedAt: Date | null;
  id: string;
  iv: string;
  ratchetIndex: number;
  sender?: MessageSender | null;
  senderId: string;
}

export interface MessagePage {
  // Index of the requested anchor inside `messages` (oldest-first), set only on
  // an anchored (`?around=`) read. -1 means the anchor is no longer visible to
  // this user (deleted, or hidden with "delete for me") and the caller got the
  // nearest older window instead.
  anchorIndex?: number;
  messages: MessageData[];
  // Cursor for paging newer. Absent on the default read (new messages arrive
  // over the realtime stream), present once a window has been anchored in the
  // middle of history and the transcript has to grow upward as well as down.
  nextCursor?: string | null;
  previousCursor: string | null;
}

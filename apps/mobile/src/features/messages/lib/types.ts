// Wire types for the messages API, ported from apps/web/src/lib/messages/types.ts.
//
// One deliberate difference: `CommunityRoleRow` is declared here instead of
// imported from `@asm/db`. That package is server-side (it pulls the Prisma
// client), and mobile already follows the rule that client modules never import
// it. The shape is identical, so a member object produced by either client
// serialises the same.

export interface CommunityRoleRow {
  community: {
    accentColor: string;
    avatarUrl: string | null;
    name: string;
    slug: string;
  };
  role: "MEMBER" | "MODERATOR" | "OWNER" | "PARTICIPANT";
}

export interface MessageIdentitySummary {
  publicKey: string;
}

export interface MessageSender {
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  // The peer's chosen banner, so a contact card can show the header image they
  // picked in settings instead of a decorative gradient.
  bannerUrl?: string | null;
  communityMemberships: CommunityRoleRow[];
  displayName: string;
  id: string;
  username: string;
}

export interface MessageConversationMember {
  conversationId: string;
  lastDeliveredAt?: string | null;
  lastReadAt: string | null;
  mutedAt?: string | null;
  themeKey?: string | null;
  user: MessageSender & {
    messageIdentity: MessageIdentitySummary | null;
  };
  userId: string;
}

export interface MessageConversationKey {
  conversationId: string;
  createdAt: string;
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
  createdAt: string;
  id: string;
  keys: MessageConversationKey[];
  members: MessageConversationMember[];
  pairKey: string | null;
  updatedAt: string;
}

export interface MessageData {
  ciphertext: string;
  conversationId: string;
  createdAt: string;
  deletedAt: string | null;
  // Set when the sender rewrote this message in place. The ratchet index never
  // changes, so receivers re-decrypt the row rather than appending a new one.
  editedAt: string | null;
  id: string;
  iv: string;
  ratchetIndex: number;
  sender?: MessageSender | null;
  senderId: string;
}

export interface MessagePage {
  // Index of the requested anchor inside `messages` (oldest-first), set only on
  // an anchored (`?around=`) read. -1 means the anchor is no longer visible to
  // this user and the caller got the nearest older window instead.
  anchorIndex?: number;
  messages: MessageData[];
  nextCursor?: string | null;
  previousCursor: string | null;
}

/**
 * A message as the SSE stream delivers it: `createdAt` is a revived `Date` when
 * the frame came off the wire and a string when it came out of the query cache,
 * depending on which writer produced the row. Every reader accepts both, which is
 * why this is a union rather than a narrowing at each call site.
 */
export interface StreamMessageRow extends Omit<MessageData, "createdAt"> {
  createdAt: string | Date;
}

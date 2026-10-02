import type { CommunityRoleRow, ConversationType, DenRole } from "@asm/db";

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
  // When this person joined. Den send paths read it to tell a member who was in
  // the room when the current root-key epoch was minted from one who arrived
  // after it: the first can be handed a missing wrap for that epoch, the second
  // must not be, because that epoch's root already encrypts everything written
  // before they arrived.
  createdAt: Date;
  // Den-only provenance: who added this member, absent for the creator and for
  // somebody who arrived through an invite link.
  invitedById?: string | null;
  lastReadAt: Date | null;
  // Watermark of the newest message this member confirmed receipt of, and this
  // member's own DM preferences. Both are per-member, so the peer never sees
  // them. mutedAt is a real event timestamp, not a boolean.
  lastDeliveredAt?: Date | null;
  mutedAt?: Date | null;
  themeKey?: string | null;
  // Den-only. A DM row carries MEMBER, which no gate reads: DM authorization is
  // membership, not role.
  role?: DenRole;
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
  // Which member performed this wrap, and the public key they used. Null on
  // every DM row written before these columns existed, where the wrapper is
  // unambiguously the single peer. A den reader needs both to know whose ECDH
  // pairing this blob was made for.
  wrapperPublicKey?: string | null;
  wrapperUserId?: string | null;
}

export interface MessageConversationData {
  createdAt: Date;
  id: string;
  keys: MessageConversationKey[];
  members: MessageConversationMember[];
  pairKey: string | null;
  updatedAt: Date;
  // Den-only columns, null on a DM. `type` is required rather than optional: it is
  // the field every gate reads to decide whether it is looking at a pair or at a
  // group, it is NOT NULL in the database with a DM default, and every server
  // mapper sets it. Making it optional here would push a `?? "DM"` fallback onto
  // every future call site, which is exactly the kind of default that hides a
  // route that forgot to branch.
  type: ConversationType;
  avatarMediaId?: string | null;
  createdById?: string | null;
  description?: string | null;
  inviteCode?: string | null;
  name?: string | null;
  ownerId?: string | null;
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

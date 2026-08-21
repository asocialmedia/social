import { messageConversationInclude, prisma } from "@asm/db";

// The server never sees plaintext, but it does validate membership, follow
// relationships, and blocks so the API cannot be abused to spam or read
// outside a conversation.

// The members portion of the canonical include from @asm/db, so a consumer
// that only needs the member rows (e.g. the keys route) stays in sync with the
// full conversation include instead of drifting.
export function getConversationMembersInclude() {
  return { members: messageConversationInclude.members } as const;
}

// Returns the conversation only when `userId` is one of its members.
export async function getConversationForUser(
  conversationId: string,
  userId: string
) {
  const conversation = await prisma.messageConversation.findUnique({
    // `keys` (the wrapped conversation keys) is required by the client to
    // unwrap the root key before sending or decrypting, so include it like
    // the list and create paths do.
    include: {
      ...getConversationMembersInclude(),
      keys: true,
    },
    where: { id: conversationId },
  });
  if (!conversation) {
    return null;
  }
  if (!conversation.members.some((member) => member.userId === userId)) {
    return null;
  }
  return conversation;
}

// A block is bidirectional in practice: either party blocking is enough to
// prevent messaging between the pair.
export async function areBlocked(a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    prisma.block.findUnique({
      where: { blockerId_blockedId: { blockedId: b, blockerId: a } },
    }),
    prisma.block.findUnique({
      where: { blockerId_blockedId: { blockedId: a, blockerId: b } },
    }),
  ]);
  return Boolean(ab || ba);
}

export async function hasMessageIdentity(userId: string): Promise<boolean> {
  return (
    (await prisma.messageIdentity.findUnique({
      select: { userId: true },
      where: { userId },
    })) !== null
  );
}

export function messageSenderSelect() {
  return {
    sender: {
      select: {
        avatarUrl: true,
        badge: true,
        badges: true,
        displayName: true,
        id: true,
        username: true,
      },
    },
  } as const;
}

// The where clause shared by every unread-message count: the current user's
// own sent messages never accrue a badge (the writer only increments the
// peer), and soft-deleted messages are not counted. Kept in one place so the
// read, list, and badge-seed routes cannot drift.
export function unreadMessageWhere(params: {
  conversationId: string;
  lastReadAt: Date | null;
  userId: string;
}): {
  conversationId: string;
  createdAt: { gt: Date };
  deletedAt: null;
  senderId: { not: string };
} {
  return {
    conversationId: params.conversationId,
    createdAt: { gt: params.lastReadAt ?? new Date(0) },
    deletedAt: null,
    senderId: { not: params.userId },
  };
}

// The sender's current ratchet index. The authoritative source is the message
// count for that (conversation, sender) pair - indexes are dense (0, 1, 2, ...)
// so the count IS the next index. The atomic per-owner counter on the key row
// is kept in step with the count, but may lag behind rows created before the
// counter existed, so take the max of the two. The unique
// (conversationId, senderId, ratchetIndex) constraint still guards concurrent
// sends that race between the read and the create.
export async function nextRatchetIndex(
  conversationId: string,
  senderId: string
): Promise<number> {
  const [key, sentCount] = await Promise.all([
    prisma.messageConversationKey.findUnique({
      select: { ratchetCounter: true },
      where: {
        conversationId_ownerUserId: { conversationId, ownerUserId: senderId },
      },
    }),
    prisma.message.count({ where: { conversationId, senderId } }),
  ]);
  return Math.max(key?.ratchetCounter ?? 0, sentCount);
}

// Safely parses a request body. A malformed JSON body returns null so the
// route can answer 400 instead of letting the parse rejection bubble into a
// 500. Routes cast the result to their own payload shape and validate fields
// themselves.
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Prisma surfaces unique constraint conflicts as P2002.
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

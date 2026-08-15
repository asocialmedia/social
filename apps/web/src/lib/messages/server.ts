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

// The sender's current ratchet index: the atomic per-owner counter on the
// conversation key row. Falls back to a dense count when the row is missing
// (a conversation created before keys were introduced) so legacy threads keep
// working; the unique (conversationId, senderId, ratchetIndex) constraint
// still guards the race in that fallback.
export async function nextRatchetIndex(
  conversationId: string,
  senderId: string
): Promise<number> {
  try {
    const key = await prisma.messageConversationKey.findUnique({
      select: { ratchetCounter: true },
      where: {
        conversationId_ownerUserId: { conversationId, ownerUserId: senderId },
      },
    });
    return key?.ratchetCounter ?? 0;
  } catch {
    // Legacy conversation without a counter row: fall back to the dense count.
    return prisma.message.count({ where: { conversationId, senderId } });
  }
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

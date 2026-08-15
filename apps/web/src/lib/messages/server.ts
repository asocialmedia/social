import { prisma } from "@asm/db";

// The server never sees plaintext, but it does validate membership, follow
// relationships, and blocks so the API cannot be abused to spam or read
// outside a conversation.

export function getConversationMembersInclude() {
  return {
    members: {
      include: {
        user: {
          select: {
            avatarUrl: true,
            badge: true,
            displayName: true,
            id: true,
            messageIdentity: {
              select: { publicKey: true },
            },
            username: true,
          },
        },
      },
    },
  } as const;
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

// The next ratchet index for a sender in a conversation is exactly the number
// of messages they have already sent there (indexes are dense: 0, 1, 2, ...).
export function nextRatchetIndex(
  conversationId: string,
  senderId: string
): Promise<number> {
  return prisma.message.count({
    where: { conversationId, senderId },
  });
}

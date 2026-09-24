import {
  and,
  fromPrismaDateTime,
  getUserDataQuery,
  mapUserData,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

// The server never sees plaintext, but it does validate membership, follow
// relationships, and blocks so the API cannot be abused to spam or read
// outside a conversation.

// Returns the conversation only when `userId` is one of its members.
//
// When `enforceBlocks` is true (the default), a bidirectional block between
// the two members makes the conversation invisible: every read, key-fetch,
// stream, typing and read-receipt route resolves through this gate, so a
// blocked pair loses read/stream/delete access, not just the ability to send.
// The send path passes false so it can answer with its own clearer 403.
export async function getConversationForUser(
  conversationId: string,
  userId: string,
  options: { enforceBlocks?: boolean } = {}
) {
  const conversationRow = await prisma.orm.public.MessageConversations.select(
    "id",
    "pairKey",
    "createdAt",
    "updatedAt"
  )
    .include("messageConversationMembers", (member) =>
      member
        .select("userId", "lastReadAt")
        .include("user", (_user) =>
          getUserDataQuery(prisma.orm, "").include(
            "messageIdentities",
            (identity) => identity.select("publicKey")
          )
        )
    )
    .include("messageConversationKeys")
    .where({ id: conversationId })
    .first();
  const conversation = conversationRow
    ? {
        ...conversationRow,
        createdAt: fromPrismaDateTime(conversationRow.createdAt),
        keys: conversationRow.messageConversationKeys.map((key) => ({
          ...key,
          createdAt: fromPrismaDateTime(key.createdAt),
        })),
        members: conversationRow.messageConversationMembers.map((member) => {
          if (!member.user) {
            throw new Error("Conversation member has no user");
          }
          return {
            ...member,
            lastReadAt: member.lastReadAt
              ? fromPrismaDateTime(member.lastReadAt)
              : null,
            user: {
              ...mapUserData(member.user),
              messageIdentity: member.user.messageIdentities,
            },
          };
        }),
        updatedAt: fromPrismaDateTime(conversationRow.updatedAt),
      }
    : null;
  if (!conversation) {
    return null;
  }
  if (!conversation.members.some((member) => member.userId === userId)) {
    return null;
  }
  if (options.enforceBlocks !== false) {
    const otherMember = conversation.members.find(
      (member) => member.userId !== userId
    );
    if (otherMember && (await areBlocked(userId, otherMember.userId))) {
      return null;
    }
  }
  return conversation;
}

// A block is bidirectional in practice: either party blocking is enough to
// prevent messaging between the pair.
export async function areBlocked(a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    prisma.orm.public.Blocks.select("blockerId")
      .where((block) => and(block.blockerId.eq(a), block.blockedId.eq(b)))
      .first(),
    prisma.orm.public.Blocks.select("blockerId")
      .where((block) => and(block.blockerId.eq(b), block.blockedId.eq(a)))
      .first(),
  ]);
  return Boolean(ab || ba);
}

export async function hasMessageIdentity(userId: string): Promise<boolean> {
  return (
    (await prisma.orm.public.MessageIdentities.select("userId")
      .where({ userId })
      .first()) !== null
  );
}

export function messageSenderSelect() {
  return getUserDataQuery(prisma.orm, "");
}

// The where clause shared by every unread-message count: the current user's
// own sent messages never accrue a badge (the writer only increments the
// peer), and soft-deleted messages are not counted. Kept in one place so the
// read, list, and badge-seed routes cannot drift.
type MessageWhereCallback = (message: {
  conversationId: { eq: (value: string) => ReturnType<typeof and> };
  createdAt: {
    gt: (value: ReturnType<typeof toPrismaDateTime>) => ReturnType<typeof and>;
  };
  deletedAt: { isNull: () => ReturnType<typeof and> };
  senderId: { notIn: (value: string[]) => ReturnType<typeof and> };
}) => ReturnType<typeof and>;

export function unreadMessageWhere(params: {
  conversationId: string;
  lastReadAt: Date | null;
  userId: string;
}): MessageWhereCallback {
  return (message) =>
    and(
      message.conversationId.eq(params.conversationId),
      message.createdAt.gt(toPrismaDateTime(params.lastReadAt ?? new Date(0))),
      message.deletedAt.isNull(),
      message.senderId.notIn([params.userId])
    );
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
    prisma.orm.public.MessageConversationKeys.select("ratchetCounter")
      .where((keyRow) =>
        and(
          keyRow.conversationId.eq(conversationId),
          keyRow.ownerUserId.eq(senderId)
        )
      )
      .first(),
    prisma.orm.public.Messages.where((message) =>
      and(
        message.conversationId.eq(conversationId),
        message.senderId.eq(senderId)
      )
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
  ]);
  return Math.max(key?.ratchetCounter ?? 0, sentCount.count);
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

import { prisma } from "@asm/db";
import type { ConversationListPage, MessageConversationData } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  areBlocked,
  getConversationMembersInclude,
  hasMessageIdentity,
  isUniqueConstraintViolation,
  parseJsonBody,
  visibleToUser,
} from "@/lib/messages/server";

const PAGE_SIZE = 20;

export interface ConversationListItem {
  conversation: MessageConversationData;
  isNew: boolean;
  lastMessage: {
    ciphertext: string;
    createdAt: string;
    deletedAt: string | null;
    id: string;
    iv: string;
    ratchetIndex: number;
    senderId: string;
  } | null;
  unreadCount: number;
}

interface ConversationWithLastMessage extends MessageConversationData {
  messages: {
    ciphertext: string;
    createdAt: Date;
    deletedAt: Date | null;
    id: string;
    iv: string;
    ratchetIndex: number;
    senderId: string;
  }[];
}

function toListItem(
  conversation: ConversationWithLastMessage,
  lastMessage: ConversationWithLastMessage["messages"][number] | undefined,
  unreadCount: number
): ConversationListItem {
  return {
    conversation,
    isNew: false,
    lastMessage: lastMessage
      ? {
          ciphertext: lastMessage.ciphertext,
          createdAt: lastMessage.createdAt.toISOString(),
          deletedAt: lastMessage.deletedAt
            ? lastMessage.deletedAt.toISOString()
            : null,
          id: lastMessage.id,
          iv: lastMessage.iv,
          ratchetIndex: lastMessage.ratchetIndex,
          senderId: lastMessage.senderId,
        }
      : null,
    unreadCount,
  };
}

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  const memberships = await prisma.messageConversationMember.findMany({
    cursor: cursor
      ? { conversationId_userId: { conversationId: cursor, userId: user.id } }
      : undefined,
    include: {
      conversation: {
        include: {
          ...getConversationMembersInclude(),
          keys: true,
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            // The preview is this user's most recent VISIBLE message: a
            // "delete for me" must not resurrect a hidden row as the thread's
            // headline.
            where: visibleToUser(user.id),
          },
        },
      },
    },
    orderBy: [
      { conversation: { updatedAt: "desc" } },
      { conversationId: "desc" },
    ],
    skip: cursor ? 1 : 0,
    take: PAGE_SIZE + 1,
    where: { userId: user.id },
  });

  const hasMore = memberships.length > PAGE_SIZE;
  const page = hasMore ? memberships.slice(0, PAGE_SIZE) : memberships;

  // Blocked pairs lose all visibility into each other's metadata too: their
  // conversations are omitted from the list entirely (last-message ciphertext
  // preview and unread badge included).
  const [iBlocked, blockedMe] = await Promise.all([
    prisma.block.findMany({
      select: { blockedId: true },
      where: { blockerId: user.id },
    }),
    prisma.block.findMany({
      select: { blockerId: true },
      where: { blockedId: user.id },
    }),
  ]);
  const hiddenPartnerIds = new Set<string>([
    ...iBlocked.map((row) => row.blockedId),
    ...blockedMe.map((row) => row.blockerId),
  ]);
  const visiblePage = page.filter((membership) => {
    const other = membership.conversation.members.find(
      (member) => member.userId !== user.id
    );
    return !other || !hiddenPartnerIds.has(other.userId);
  });

  // One grouped query for the whole page instead of a count round-trip per
  // conversation. Each member's own read watermark bounds its conversation's
  // unread set, so the query fetches only genuinely-unread rows rather than
  // every message since epoch 0 (the old page-wide "earliest" bound meant one
  // never-read thread pulled all messages across the page).
  const readAtByConversation = new Map<string, Date>();
  for (const membership of visiblePage) {
    const myMember = membership.conversation.members.find(
      (member) => member.userId === user.id
    );
    readAtByConversation.set(
      membership.conversationId,
      myMember?.lastReadAt ?? new Date(0)
    );
  }
  const unreadRows =
    visiblePage.length === 0
      ? []
      : await prisma.message.findMany({
          select: { conversationId: true },
          where: {
            deletedAt: null,
            senderId: { not: user.id },
            ...visibleToUser(user.id),
            // Per-conversation bound: each OR branch carries its own watermark.
            OR: visiblePage.map((membership) => ({
              conversationId: membership.conversationId,
              createdAt: {
                gt:
                  readAtByConversation.get(membership.conversationId) ??
                  new Date(0),
              },
            })),
          },
        });

  // Bucket the (already watermark-filtered) unread rows in one pass. No further
  // per-row compare is needed: every row cleared its own conversation's bound.
  const unreadCountByConversation = new Map<string, number>();
  for (const row of unreadRows) {
    unreadCountByConversation.set(
      row.conversationId,
      (unreadCountByConversation.get(row.conversationId) ?? 0) + 1
    );
  }

  const items: ConversationListItem[] = visiblePage.map((membership) => {
    const { conversation } = membership;
    const [lastMessage] = conversation.messages;
    const unreadCount = unreadCountByConversation.get(conversation.id) ?? 0;
    return toListItem(conversation, lastMessage, unreadCount);
  });

  const last = visiblePage.at(-1);
  const response: ConversationListPage & {
    items: ConversationListItem[];
    nextCursor: string | null;
  } = {
    conversations: items.map((item) => item.conversation),
    hasMore,
    items,
    nextCursor: hasMore && last ? last.conversationId : null,
  };

  return Response.json(response);
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  const body = parsed as { recipientId?: string } | null;
  const { recipientId } = body ?? {};
  if (typeof recipientId !== "string" || recipientId.length === 0) {
    return Response.json({ error: "recipientId is required" }, { status: 400 });
  }
  if (recipientId === user.id) {
    return Response.json({ error: "Cannot message yourself" }, { status: 400 });
  }

  const recipient = await prisma.user.findUnique({
    select: { id: true },
    where: { id: recipientId },
  });
  if (!recipient) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // DMs are follow-gated: you can only start a conversation with someone you
  // follow, and both sides must have enabled messages (a public key to wrap
  // conversation keys for).
  const [iFollowThem, theyHaveIdentity, iHaveIdentity, blocked] =
    await Promise.all([
      prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: user.id,
            followingId: recipientId,
          },
        },
      }),
      hasMessageIdentity(recipientId),
      hasMessageIdentity(user.id),
      areBlocked(user.id, recipientId),
    ]);

  if (blocked) {
    return Response.json(
      { error: "You cannot message this user" },
      { status: 403 }
    );
  }
  if (!iFollowThem) {
    return Response.json(
      { error: "You can only message people you follow" },
      { status: 403 }
    );
  }
  if (!theyHaveIdentity) {
    return Response.json(
      { error: "This user hasn't enabled Messages yet" },
      { status: 409 }
    );
  }
  if (!iHaveIdentity) {
    return Response.json(
      { error: "Enable Messages first to start a conversation" },
      { status: 409 }
    );
  }

  // create-or-find: a conversation between exactly these two users. The lookup
  // requires membership by BOTH ids and rejects any thread with a third
  // member, with a deterministic order so the result is stable.
  const existing = await prisma.messageConversation.findFirst({
    include: {
      ...getConversationMembersInclude(),
      keys: true,
    },
    orderBy: { id: "desc" },
    where: {
      AND: [
        { members: { some: { userId: user.id } } },
        { members: { some: { userId: recipientId } } },
        { members: { none: { userId: { notIn: [user.id, recipientId] } } } },
      ],
    },
  });
  if (existing) {
    return Response.json({ conversation: existing, isNew: false });
  }

  // Deterministic key for the pair so two concurrent "start a chat" requests
  // for the same two users resolve to one conversation instead of racing into
  // two threads. The unique constraint turns the losing request into P2002,
  // which then returns the winner's conversation.
  const pairKey = [user.id, recipientId].toSorted().join(":");
  const conversation = await prisma.messageConversation
    .create({
      data: {
        members: {
          create: [{ userId: recipientId }, { userId: user.id }],
        },
        pairKey,
      },
      include: {
        ...getConversationMembersInclude(),
        keys: true,
      },
    })
    .catch(async (error: unknown) => {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      const winner = await prisma.messageConversation.findUnique({
        include: {
          ...getConversationMembersInclude(),
          keys: true,
        },
        where: { pairKey },
      });
      if (winner) {
        return winner;
      }
      throw error;
    });

  return Response.json({ conversation, isNew: true }, { status: 201 });
}

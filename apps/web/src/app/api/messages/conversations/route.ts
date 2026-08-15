import { prisma } from "@asm/db";
import type { ConversationListPage, MessageConversationData } from "@asm/db";

import {
  areBlocked,
  getConversationMembersInclude,
  hasMessageIdentity,
} from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

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

  const items: ConversationListItem[] = await Promise.all(
    page.map(async (membership) => {
      const { conversation } = membership;
      const [lastMessage] = conversation.messages;
      const myMember = conversation.members.find(
        (member) => member.userId === user.id
      );
      const unreadCount = lastMessage
        ? await prisma.message.count({
            where: {
              conversationId: conversation.id,
              createdAt: { gt: myMember?.lastReadAt ?? new Date(0) },
            },
          })
        : 0;
      return toListItem(conversation, lastMessage, unreadCount);
    })
  );

  const last = page.at(-1);
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

  const body = (await request.json()) as { recipientId?: string };
  const { recipientId } = body;
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

  // create-or-find: a conversation between exactly these two users.
  const existing = await prisma.messageConversation.findFirst({
    include: {
      ...getConversationMembersInclude(),
      keys: true,
    },
    where: {
      members: {
        every: { userId: { in: [user.id, recipientId] } },
      },
    },
  });
  if (existing) {
    return Response.json({ conversation: existing, isNew: false });
  }

  const conversation = await prisma.messageConversation.create({
    data: {
      members: {
        create: [{ userId: recipientId }, { userId: user.id }],
      },
    },
    include: {
      ...getConversationMembersInclude(),
      keys: true,
    },
  });

  return Response.json({ conversation, isNew: true }, { status: 201 });
}

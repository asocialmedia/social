import {
  and,
  fromPrismaDateTime,
  getMessageConversationDataQuery,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  areBlocked,
  hasMessageIdentity,
  isUniqueConstraintViolation,
  parseJsonBody,
} from "@/lib/messages/server";
import type {
  MessageConversationData,
  MessageData,
} from "@/lib/messages/types";

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

interface ConversationListPage {
  conversations: MessageConversationData[];
  hasMore: boolean;
}

type ConversationWithLastMessage = MessageConversationData & {
  messages: MessageData[];
};

type ConversationQueryData = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof getMessageConversationDataQuery>["first"]>
  >
>;

interface RawMessage {
  ciphertext: string;
  conversationId: string;
  createdAt: ConversationQueryData["createdAt"];
  deletedAt: ConversationQueryData["createdAt"] | null;
  id: string;
  iv: string;
  ratchetIndex: number;
  senderId: string;
}

type ConversationQueryDataWithMessages = ConversationQueryData & {
  messages?: RawMessage[];
};

function mapConversation(
  conversation: ConversationQueryDataWithMessages
): ConversationWithLastMessage {
  return {
    createdAt: fromPrismaDateTime(conversation.createdAt),
    id: conversation.id,
    keys: conversation.messageConversationKeys.map((key) => ({
      ...key,
      createdAt: fromPrismaDateTime(key.createdAt),
    })),
    members: conversation.messageConversationMembers.flatMap((member) => {
      const memberUser = member.user;
      if (!memberUser) {
        return [];
      }
      return [
        {
          conversationId: member.conversationId,
          lastReadAt: member.lastReadAt
            ? fromPrismaDateTime(member.lastReadAt)
            : null,
          user: {
            avatarUrl: memberUser.avatarUrl,
            badge: memberUser.badge,
            badges: memberUser.badges ?? [],
            communityMemberships: memberUser.communityMembers.flatMap(
              (membership) =>
                membership.community
                  ? [
                      {
                        community: membership.community,
                        role: membership.role,
                      },
                    ]
                  : []
            ),
            displayName: memberUser.displayName,
            id: memberUser.id,
            messageIdentity: memberUser.messageIdentities,
            username: memberUser.username,
          },
          userId: member.userId,
        },
      ];
    }),
    messages: (conversation.messages ?? []).map((message) => ({
      ...message,
      createdAt: fromPrismaDateTime(message.createdAt),
      deletedAt: message.deletedAt
        ? fromPrismaDateTime(message.deletedAt)
        : null,
    })),
    pairKey: conversation.pairKey,
    updatedAt: fromPrismaDateTime(conversation.updatedAt),
  };
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

  const conversationQuery = getMessageConversationDataQuery(prisma.orm)
    .include("messages", (message) =>
      message
        .orderBy([(row) => row.createdAt.desc(), (row) => row.id.desc()])
        .limit(1)
    )
    .where((conversation) =>
      conversation.messageConversationMembers.some((member) =>
        member.userId.eq(user.id)
      )
    )
    .orderBy([
      (conversation) => conversation.updatedAt.desc(),
      (conversation) => conversation.id.desc(),
    ])
    .limit(PAGE_SIZE + 1);
  const conversationRows = await (
    cursor ? conversationQuery.cursor({ id: cursor }) : conversationQuery
  )
    .offset(cursor ? 1 : 0)
    .all();
  const page = conversationRows.map(mapConversation);
  const hasMore = page.length > PAGE_SIZE;
  const visiblePage = hasMore ? page.slice(0, PAGE_SIZE) : page;

  const [iBlocked, blockedMe] = await Promise.all([
    prisma.orm.public.Blocks.select("blockedId")
      .where({ blockerId: user.id })
      .all(),
    prisma.orm.public.Blocks.select("blockerId")
      .where({ blockedId: user.id })
      .all(),
  ]);
  const hiddenPartnerIds = new Set<string>([
    ...iBlocked.map((row) => row.blockedId),
    ...blockedMe.map((row) => row.blockerId),
  ]);
  const visibleConversations = visiblePage.filter((conversation) => {
    const other = conversation.members.find(
      (member) => member.userId !== user.id
    );
    return !other || !hiddenPartnerIds.has(other.userId);
  });

  const pageIds = visibleConversations.map((conversation) => conversation.id);
  let earliestReadAt: number | null = null;
  for (const conversation of visibleConversations) {
    const myMember = conversation.members.find(
      (member) => member.userId === user.id
    );
    const readAt = myMember?.lastReadAt?.getTime() ?? 0;
    if (earliestReadAt === null || readAt < earliestReadAt) {
      earliestReadAt = readAt;
    }
  }
  const unreadRows =
    pageIds.length === 0
      ? []
      : await prisma.orm.public.Messages.select("conversationId", "createdAt")
          .where((message) =>
            and(
              message.conversationId.in(pageIds),
              message.createdAt.gt(
                toPrismaDateTime(new Date(earliestReadAt ?? 0))
              ),
              message.deletedAt.isNull(),
              message.senderId.notIn([user.id])
            )
          )
          .all();

  const items: ConversationListItem[] = visibleConversations.map(
    (conversation) => {
      const [lastMessage] = conversation.messages;
      const myMember = conversation.members.find(
        (member) => member.userId === user.id
      );
      const lastReadAt = myMember?.lastReadAt ?? new Date(0);
      const unreadCount = lastMessage
        ? unreadRows.filter(
            (row) =>
              row.conversationId === conversation.id &&
              fromPrismaDateTime(row.createdAt) > lastReadAt
          ).length
        : 0;
      return toListItem(conversation, lastMessage, unreadCount);
    }
  );

  const last = visibleConversations.at(-1);
  const response: ConversationListPage & {
    items: ConversationListItem[];
    nextCursor: string | null;
  } = {
    conversations: items.map((item) => item.conversation),
    hasMore,
    items,
    nextCursor: hasMore && last ? last.id : null,
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

  const recipient = await prisma.orm.public.Users.select("id")
    .where({ id: recipientId })
    .first();
  if (!recipient) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // DMs are follow-gated: you can only start a conversation with someone you
  // follow, and both sides must have enabled messages (a public key to wrap
  // conversation keys for).
  const [iFollowThem, theyHaveIdentity, iHaveIdentity, blocked] =
    await Promise.all([
      prisma.orm.public.Follows.select("followerId")
        .where((follow) =>
          and(follow.followerId.eq(user.id), follow.followingId.eq(recipientId))
        )
        .first(),
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
  const existingRow = await getMessageConversationDataQuery(prisma.orm)
    .where((conversation) =>
      and(
        conversation.messageConversationMembers.some((member) =>
          member.userId.eq(user.id)
        ),
        conversation.messageConversationMembers.some((member) =>
          member.userId.eq(recipientId)
        ),
        conversation.messageConversationMembers.none((member) =>
          member.userId.notIn([user.id, recipientId])
        )
      )
    )
    .orderBy((conversation) => conversation.id.desc())
    .first();
  if (existingRow) {
    return Response.json({
      conversation: mapConversation(existingRow),
      isNew: false,
    });
  }

  // Deterministic key for the pair so two concurrent "start a chat" requests
  // for the same two users resolve to one conversation instead of racing into
  // two threads. The unique constraint turns the losing request into P2002,
  // which then returns the winner's conversation.
  const pairKey = [user.id, recipientId].toSorted().join(":");
  const conversation = await prisma
    .transaction(async (tx) => {
      const created = await tx.orm.public.MessageConversations.create({
        pairKey,
      });
      await tx.orm.public.MessageConversationMembers.create({
        conversationId: created.id,
        userId: recipientId,
      });
      await tx.orm.public.MessageConversationMembers.create({
        conversationId: created.id,
        userId: user.id,
      });
      const row = await getMessageConversationDataQuery(tx.orm)
        .where({ id: created.id })
        .first();
      if (!row) {
        throw new Error("Conversation not found after creation");
      }
      return mapConversation(row);
    })
    .catch(async (error: unknown) => {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      const winner = await getMessageConversationDataQuery(prisma.orm)
        .where({ pairKey })
        .first();
      if (winner) {
        return mapConversation(winner);
      }
      throw error;
    });

  return Response.json({ conversation, isNew: true }, { status: 201 });
}

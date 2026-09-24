import {
  and,
  fromPrismaDateTime,
  getMessageDataQuery,
  prisma,
  publishMessageCreated,
  toPrismaDateTime,
  unreadMessageCache,
} from "@asm/db";
import type { PrismaTransaction } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  areBlocked,
  getConversationForUser,
  isUniqueConstraintViolation,
  nextRatchetIndex,
  parseJsonBody,
} from "@/lib/messages/server";
import type { MessageData, MessagePage } from "@/lib/messages/types";

const PAGE_SIZE = 30;
const MAX_CAS_ATTEMPTS = 8;

async function updateMessageRatchetWithCas(
  tx: PrismaTransaction,
  conversationId: string,
  ownerUserId: string,
  attemptsRemaining = MAX_CAS_ATTEMPTS
): Promise<void> {
  const key = await tx.orm.public.MessageConversationKeys.select(
    "ratchetCounter"
  )
    .where((candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.ownerUserId.eq(ownerUserId)
      )
    )
    .first();
  if (!key) {
    return;
  }
  const updated = await tx.orm.public.MessageConversationKeys.where(
    (candidate) =>
      and(
        candidate.conversationId.eq(conversationId),
        candidate.ownerUserId.eq(ownerUserId),
        candidate.ratchetCounter.eq(key.ratchetCounter)
      )
  ).updateAndCount({ ratchetCounter: key.ratchetCounter + 1 });
  if (updated === 1) {
    return;
  }
  if (attemptsRemaining <= 1) {
    throw new Error("Could not update message ratchet");
  }
  return updateMessageRatchetWithCas(
    tx,
    conversationId,
    ownerUserId,
    attemptsRemaining - 1
  );
}

type MessageQueryData = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getMessageDataQuery>["first"]>>
>;

function mapMessage(message: MessageQueryData): MessageData {
  return {
    ciphertext: message.ciphertext ?? "",
    conversationId: message.conversationId ?? "",
    createdAt: fromPrismaDateTime(message.createdAt),
    deletedAt: message.deletedAt ? fromPrismaDateTime(message.deletedAt) : null,
    id: message.id ?? "",
    iv: message.iv ?? "",
    ratchetIndex: message.ratchetIndex ?? 0,
    sender: message.sender
      ? {
          avatarUrl: message.sender.avatarUrl,
          badge: message.sender.badge,
          badges: message.sender.badges ?? [],
          communityMemberships: [],
          displayName: message.sender.displayName,
          id: message.sender.id,
          username: message.sender.username,
        }
      : null,
    senderId: message.senderId ?? "",
  };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  // Newest first from the cursor, then reversed so the client gets oldest-first.
  // The cursor is a message id, so ordering by id keeps the cursor and the sort
  // in the same total order - sorting by createdAt with an id cursor would skip
  // or duplicate messages on long threads where many share a timestamp.
  // (Prisma cuids are time-ordered, so id desc is still newest-first.)
  const messageQuery = getMessageDataQuery(prisma.orm)
    .where((message) =>
      and(
        message.conversationId.eq(id),
        ...(cursor ? [message.id.lt(cursor)] : [])
      )
    )
    .orderBy((message) => message.id.desc())
    .limit(PAGE_SIZE + 1);
  const messageRows = await messageQuery.all();
  const messages = messageRows.map(mapMessage);

  const hasMore = messages.length > PAGE_SIZE;
  const page = hasMore ? messages.slice(0, PAGE_SIZE) : messages;
  const lastMessage = page.at(-1);
  const previousCursor = hasMore && lastMessage ? lastMessage.id : null;

  const response: MessagePage = {
    messages: [...page].toReversed(),
    previousCursor,
  };

  return Response.json(response);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // The send path keeps its own clearer 403 for blocks, so the shared gate
  // runs membership-only here.
  const conversation = await getConversationForUser(id, user.id, {
    enforceBlocks: false,
  });
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request);
  const body = parsed as {
    ciphertext?: string;
    iv?: string;
    ratchetIndex?: number;
  } | null;
  if (
    body === null ||
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length === 0 ||
    typeof body.iv !== "string" ||
    body.iv.length === 0 ||
    typeof body.ratchetIndex !== "number"
  ) {
    return Response.json({ error: "Invalid message payload" }, { status: 400 });
  }
  // Narrowed consts so the transaction closure below sees definite types
  // (property narrowing does not survive into the arrow function).
  const { ciphertext } = body;
  const { iv } = body;
  const { ratchetIndex } = body;

  const otherMember = conversation.members.find(
    (member) => member.userId !== user.id
  );
  if (otherMember && (await areBlocked(user.id, otherMember.userId))) {
    return Response.json(
      { error: "You cannot message this user" },
      { status: 403 }
    );
  }

  // The ratchet index is authoritative on the server: it must equal the
  // sender's atomic per-conversation counter. If the client's count is stale
  // (e.g. a send raced another send), reject so the receiver can still derive
  // the correct message key.
  const expectedIndex = await nextRatchetIndex(id, user.id);
  if (ratchetIndex !== expectedIndex) {
    return Response.json(
      { error: "ratchet index mismatch", expectedIndex },
      { status: 409 }
    );
  }

  let message: MessageData | null = null;
  let createdMessageId: string | null = null;
  try {
    await prisma.transaction(async (tx) => {
      const created = await tx.orm.public.Messages.create({
        ciphertext,
        conversationId: id,
        iv,
        ratchetIndex: expectedIndex,
        senderId: user.id,
      });
      createdMessageId = created.id;

      await updateMessageRatchetWithCas(tx, id, user.id);

      await tx.orm.public.MessageConversations.where({ id }).update({
        updatedAt: toPrismaDateTime(new Date()),
      });
    });
  } catch (error) {
    // A concurrent send beat us to the same ratchet index. Hand back the
    // authoritative counter so the client can retry at the right position.
    if (isUniqueConstraintViolation(error)) {
      const fresh = await nextRatchetIndex(id, user.id);
      return Response.json(
        { error: "ratchet index mismatch", expectedIndex: fresh },
        { status: 409 }
      );
    }
    throw error;
  }

  if (!createdMessageId) {
    throw new Error("Message was not created");
  }
  const messageRow = await getMessageDataQuery(prisma.orm)
    .where({ id: createdMessageId })
    .first();
  if (messageRow) {
    message = mapMessage(messageRow);
  }

  // The sender always reads their own messages; only the peer accrues unread.
  // Both Redis side effects are best-effort: once the message is committed,
  // a notification failure must not turn a successful send into an error.
  if (otherMember) {
    try {
      await unreadMessageCache.increment(otherMember.userId);
    } catch (error) {
      console.error("Failed to increment unread message count:", error);
    }
  }
  try {
    // The message is guaranteed present after a committed transaction.
    if (message) {
      await publishMessageCreated(id, message);
    }
  } catch (error) {
    console.error("Failed to publish message created:", error);
  }

  return Response.json({ message }, { status: 201 });
}

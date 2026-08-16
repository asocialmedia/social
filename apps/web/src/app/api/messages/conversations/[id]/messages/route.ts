import type { MessageData, MessagePage } from "@asm/db";
import { prisma, publishMessageCreated, unreadMessageCache } from "@asm/db";

import {
  areBlocked,
  getConversationForUser,
  isUniqueConstraintViolation,
  messageSenderSelect,
  nextRatchetIndex,
  parseJsonBody,
} from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

const PAGE_SIZE = 30;

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
  const messages = await prisma.message.findMany({
    include: messageSenderSelect(),
    orderBy: [{ id: "desc" }],
    take: PAGE_SIZE + 1,
    where: { conversationId: id, ...(cursor ? { id: { lt: cursor } } : {}) },
  });

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
  const conversation = await getConversationForUser(id, user.id);
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
  try {
    await prisma.$transaction(async (tx) => {
      // The transaction client types the create without the include; the
      // runtime row does carry the sender (Prisma applies includes in
      // transactions too), so cast to the shape the client expects.
      message = (await tx.message.create({
        data: {
          ciphertext,
          conversationId: id,
          iv,
          ratchetIndex: expectedIndex,
          senderId: user.id,
        },
        include: messageSenderSelect(),
      })) as unknown as MessageData;

      // Advance the sender's atomic counter so the next index is fresh.
      // updateMany tolerates a missing key row (legacy conversation) instead
      // of throwing, keeping the dense count-based fallback consistent.
      await tx.messageConversationKey.updateMany({
        data: { ratchetCounter: { increment: 1 } },
        where: { conversationId: id, ownerUserId: user.id },
      });

      // Bump the conversation so the list page reorders this thread to the top
      // on activity. @updatedAt only fires when the row itself is updated.
      await tx.messageConversation.update({
        data: { updatedAt: new Date() },
        where: { id },
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

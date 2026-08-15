import type { MessagePage } from "@asm/db";
import { prisma, publishMessageCreated, unreadMessageCache } from "@asm/db";

import {
  areBlocked,
  getConversationForUser,
  messageSenderSelect,
  nextRatchetIndex,
} from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

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

  const body = (await request.json()) as {
    ciphertext?: string;
    iv?: string;
    ratchetIndex?: number;
  };
  if (
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length === 0 ||
    typeof body.iv !== "string" ||
    body.iv.length === 0 ||
    typeof body.ratchetIndex !== "number"
  ) {
    return Response.json({ error: "Invalid message payload" }, { status: 400 });
  }

  const otherMember = conversation.members.find(
    (member) => member.userId !== user.id
  );
  if (otherMember && (await areBlocked(user.id, otherMember.userId))) {
    return Response.json(
      { error: "You cannot message this user" },
      { status: 403 }
    );
  }

  // The ratchet index is authoritative on the server: it must equal the number
  // of messages this sender already has in the conversation. If the client's
  // count is stale (e.g. a send raced another send), reject so the receiver
  // can still derive the correct message key.
  const expectedIndex = await nextRatchetIndex(id, user.id);
  if (body.ratchetIndex !== expectedIndex) {
    return Response.json(
      { error: "ratchet index mismatch", expectedIndex },
      { status: 409 }
    );
  }

  const message = await prisma.message.create({
    data: {
      ciphertext: body.ciphertext,
      conversationId: id,
      iv: body.iv,
      ratchetIndex: expectedIndex,
      senderId: user.id,
    },
    include: messageSenderSelect(),
  });

  // The sender always reads their own messages; only the peer accrues unread.
  if (otherMember) {
    await unreadMessageCache.increment(otherMember.userId);
  }
  await publishMessageCreated(id, message);

  return Response.json({ message }, { status: 201 });
}

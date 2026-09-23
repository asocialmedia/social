import { prisma, publishConversationDelivered } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { getConversationForUser, parseJsonBody } from "@/lib/messages/server";

// Delivery acknowledgement. A browser that has received a peer message reports
// it so the sender can label its own bubble Delivered. The server stores a
// per-member watermark (the createdAt of the newest acked message) rather than
// a row per message, so a long conversation costs one timestamp and one indexed
// update per ack instead of unbounded growth.
//
// Only the peer's messages are acked: a sender's own rows are trivially
// "delivered" to itself and must not move its watermark. The watermark only ever
// moves forward, so a late or duplicate ack is a no-op.
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

  const body = (await parseJsonBody(request)) as { messageId?: unknown } | null;
  const { messageId } = body ?? {};
  if (typeof messageId !== "string" || messageId.length === 0) {
    return Response.json({ error: "messageId is required" }, { status: 400 });
  }

  const message = await prisma.message.findFirst({
    select: { createdAt: true, senderId: true },
    where: { conversationId: id, id: messageId },
  });
  if (!message) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }
  // Acking your own message would let a client inflate its own watermark (and
  // then mislabel the peer's messages). The watermark is the peer's receipt.
  if (message.senderId === user.id) {
    return Response.json({ ok: true });
  }

  // Monotonic advance: the conditional where makes a stale ack a no-op and
  // keeps two concurrent acks from moving the watermark backwards.
  const advanced = await prisma.messageConversationMember.updateMany({
    data: { lastDeliveredAt: message.createdAt },
    where: {
      OR: [
        { lastDeliveredAt: null },
        { lastDeliveredAt: { lt: message.createdAt } },
      ],
      conversationId: id,
      userId: user.id,
    },
  });
  if (advanced.count === 0) {
    return Response.json({ ok: true });
  }

  try {
    await publishConversationDelivered(
      id,
      user.id,
      message.createdAt.toISOString()
    );
  } catch (error) {
    // The watermark is durable; a failed broadcast must not fail the ack. The
    // sender reconciles from the conversation detail on next open/reconnect.
    console.error("Failed to publish conversation delivered:", error);
  }

  return Response.json({ ok: true });
}

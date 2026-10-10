import {
  and,
  fromPrismaDateTime,
  listDevicePushTokens,
  listPushSubscriptions,
  or,
  prisma,
  pruneDevicePushTokens,
  prunePushSubscriptions,
  visibleToUser,
} from "@asm/db";
import { dispatchNotificationPush } from "@asm/notifications/server";
import type { PushDelivery } from "@asm/notifications/server";

import { resolveLogger, withSpan } from "./log";
import type { WorkerLogger } from "./log";

export interface MessagePushJob {
  messageId: string;
  recipientId: string;
}

export async function loadMessagePush({
  messageId,
  recipientId,
}: MessagePushJob): Promise<PushDelivery | null> {
  const message = await prisma.orm.public.Messages.select(
    "id",
    "conversationId",
    "senderId",
    "createdAt",
    "deletedAt"
  )
    .include("sender", (sender) => sender.select("displayName", "username"))
    .where((row) => and(row.id.eq(messageId), visibleToUser(recipientId)(row)))
    .first();
  if (!message || message.deletedAt || message.senderId === recipientId) {
    return null;
  }
  const createdAt = fromPrismaDateTime(message.createdAt).getTime();
  if (Date.now() - createdAt > 24 * 60 * 60 * 1000) {
    return null;
  }
  const members = await prisma.orm.public.MessageConversationMembers.select(
    "userId",
    "mutedAt",
    "lastReadAt"
  )
    .where({ conversationId: message.conversationId })
    .all();
  const recipient = members.find((member) => member.userId === recipientId);
  if (
    !recipient ||
    recipient.mutedAt ||
    !members.some((member) => member.userId === message.senderId) ||
    (recipient.lastReadAt &&
      fromPrismaDateTime(recipient.lastReadAt).getTime() >= createdAt)
  ) {
    return null;
  }
  const block = await prisma.orm.public.Blocks.select("blockerId")
    .where((row) =>
      or(
        and(row.blockerId.eq(recipientId), row.blockedId.eq(message.senderId)),
        and(row.blockerId.eq(message.senderId), row.blockedId.eq(recipientId))
      )
    )
    .first();
  if (block) {
    return null;
  }
  return {
    id: message.id,
    payload: {
      body: "Sent you a message",
      path: `/messages?c=${message.conversationId}`,
      tag: `message:${message.conversationId}`,
      title:
        message.sender?.displayName || message.sender?.username || "Someone",
    },
    recipientId,
  };
}

export async function processMessagePush(
  data: MessagePushJob,
  logger?: WorkerLogger,
  dependencies: {
    load?: typeof loadMessagePush;
    dispatch?: typeof dispatchNotificationPush;
  } = {}
): Promise<void> {
  const log = resolveLogger(logger);
  await withSpan("job.message-push", async () => {
    const notification = await (dependencies.load ?? loadMessagePush)(data);
    if (!notification) {
      return;
    }
    const result = await (dependencies.dispatch ?? dispatchNotificationPush)(
      notification,
      {
        listDeviceTokens: listDevicePushTokens,
        listSubscriptions: listPushSubscriptions,
        logger: {
          error: (message, meta) => log.error(meta ?? {}, message),
          info: (message, meta) => log.info(meta ?? {}, message),
          warn: (message, meta) => log.warn(meta ?? {}, message),
        },
        pruneDeviceTokens: pruneDevicePushTokens,
        pruneSubscriptions: prunePushSubscriptions,
      }
    );
    if (result.retryable) {
      throw new Error("Message push infrastructure unavailable");
    }
  });
}

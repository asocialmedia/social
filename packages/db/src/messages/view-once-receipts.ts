import type { ViewOnceReceipt } from "@asm/messages";

import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { messageInteractionAllowed } from "./access/interaction-access";
import { rawQuery } from "./infrastructure/raw-sql";
import { ChatLifecycleError, lockChatLifecycle } from "./lifecycle";

async function receiptTarget(
  conversationId: string,
  mediaId: string,
  userId: string,
  tx?: PrismaTransaction
) {
  const { rows } = await rawQuery<{
    messageId: string;
    sessionId: string | null;
    senderId: string;
  }>(
    `SELECT COALESCE(m.id,i.id) AS "messageId",i."sessionId",COALESCE(m."senderId",i."senderId") AS "senderId"
    FROM (SELECT "messageId","incognitoMessageId" FROM public.message_media_links WHERE "mediaId"=$2 AND "viewOnce"=true
      UNION SELECT "messageId","incognitoMessageId" FROM public.message_view_once_receipts WHERE "mediaId"=$2) target
    LEFT JOIN public.messages m ON m.id=target."messageId"
    LEFT JOIN public.message_incognito_messages i ON i.id=target."incognitoMessageId"
    LEFT JOIN public.message_incognito_sessions s ON s.id=i."sessionId"
    WHERE m."conversationId"=$1 OR s."conversationId"=$1 LIMIT 1`,
    [conversationId, mediaId],
    {
      messageId: "pg/text@1",
      senderId: "pg/text@1",
      sessionId: { codecId: "pg/text@1", nullable: true },
    },
    tx
  );
  const [target] = rows;
  if (
    !target ||
    !(await messageInteractionAllowed(
      {
        conversationId,
        messageId: target.messageId,
        sessionId: target.sessionId ?? undefined,
        userId,
      },
      tx
    ))
  ) {
    throw new ChatLifecycleError("VIEW_ONCE_UNAVAILABLE", 404);
  }
  return target;
}

export async function getViewOnceReceipt(
  conversationId: string,
  mediaId: string,
  userId: string
): Promise<ViewOnceReceipt> {
  const target = await receiptTarget(conversationId, mediaId, userId);
  const { rows } = await rawQuery<{
    seenAt: Date | null;
    unavailable: boolean;
  }>(
    `SELECT (SELECT MIN(r."seenAt") FROM public.message_view_once_receipts r
        WHERE r."mediaId"=$1 AND ($3::boolean OR r."userId"=$2)) AS "seenAt",
      ((NOT $3::boolean AND NOT EXISTS (SELECT 1 FROM public.message_view_once_recipients r
        JOIN public.message_media_links l ON l.id=r."mediaLinkId" WHERE l."mediaId"=$1 AND r."userId"=$2))
        OR EXISTS (SELECT 1 FROM public.message_view_once_receipts r WHERE r."mediaId"=$1 AND r."userId"=$2)
        OR NOT EXISTS(SELECT 1 FROM public.message_media_links l JOIN public.post_media p ON p.id=l."mediaId"
          WHERE l."mediaId"=$1 AND l."viewOnce"=true AND l."deliveryExpiresAt">clock_timestamp() AND p.status='READY')) AS unavailable`,
    [mediaId, userId, target.senderId === userId],
    {
      seenAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
      unavailable: "pg/bool@1",
    }
  );
  return {
    seenAt: rows[0]?.seenAt?.toISOString() ?? null,
    unavailable: rows[0]?.unavailable ?? true,
  };
}

export function acknowledgeViewOnceSeen(
  conversationId: string,
  mediaId: string,
  userId: string,
  grantId: string
): Promise<{ seenAt: string; changed: boolean }> {
  return prisma.transaction(async (tx) => {
    await lockChatLifecycle(conversationId, userId, tx);
    await receiptTarget(conversationId, mediaId, userId, tx);
    const { rows } = await rawQuery<{ seenAt: Date; changed: boolean }>(
      `WITH target AS (SELECT id,"seenAt" FROM public.message_view_once_receipts
        WHERE id=$1 AND "mediaId"=$2 AND "userId"=$3
        AND ("seenAt" IS NOT NULL OR "openedAt">clock_timestamp()-interval '5 minutes') FOR UPDATE)
      UPDATE public.message_view_once_receipts r SET "seenAt"=COALESCE(r."seenAt",clock_timestamp()) FROM target
        WHERE r.id=target.id RETURNING r."seenAt",(target."seenAt" IS NULL) AS changed`,
      [grantId, mediaId, userId],
      { changed: "pg/bool@1", seenAt: "pg/timestamp-temporal@1" },
      tx
    );
    if (!rows[0]) {
      throw new ChatLifecycleError("VIEW_ONCE_UNAVAILABLE", 404);
    }
    return { changed: rows[0].changed, seenAt: rows[0].seenAt.toISOString() };
  });
}

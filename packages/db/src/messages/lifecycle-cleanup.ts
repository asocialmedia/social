// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { requireLifecycleValue } from "@asm/messages";

import {
  enqueueMediaDeleteCascade,
  enqueueMessageSearchOutbox,
  unreadMessageCache,
} from "../../queue";
import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { rawExecute, rawQuery } from "./infrastructure/raw-sql";

const erasedMediaFields = `status='DELETED',"failureCode"='CHAT_LIFECYCLE_ERASURE',"originalName"=NULL,"ocrText"=NULL,transcript=NULL,"altText"=NULL,"generatedAltText"=NULL,"blurDataUrl"=NULL,semantics=NULL,"semanticTags"=NULL,"techMetadata"=NULL,"aiProvenance"=NULL,safety=NULL,sha256=NULL,phash=NULL,"failureDetail"=NULL`;

async function eraseMediaReferences(
  field: "messageId" | "incognitoMessageId",
  ids: string[],
  tx: PrismaTransaction
) {
  if (!ids.length) {
    return;
  }
  await rawExecute(
    `UPDATE public.post_media p SET ${erasedMediaFields}
    WHERE p.id IN (SELECT "mediaId" FROM public.message_media_links WHERE "${field}"=ANY($1::text[]))
    AND p."messageLifecycleProtected" AND p."postId" IS NULL AND p."commentId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.message_media_links l
      LEFT JOIN public.messages m ON m.id=l."messageId"
      LEFT JOIN public.message_incognito_messages i ON i.id=l."incognitoMessageId"
      LEFT JOIN public.message_incognito_sessions s ON s.id=i."sessionId"
      WHERE l."mediaId"=p.id AND ((m.id IS NOT NULL AND m."deletedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt">clock_timestamp()))
        OR (i.id IS NOT NULL AND s."endedAt" IS NULL AND i."createdAt">clock_timestamp()-interval '24 hours')))`,
    [ids],
    tx
  );
  await rawExecute(
    `DELETE FROM public.message_media_links WHERE "${field}"=ANY($1::text[])`,
    [ids],
    tx
  );
}

// Staged incognito uploads have incognitoSessionId but no message link yet. They must be erased
// when the session ends, otherwise a held staged URL would survive the session.
async function eraseStagedIncognitoMedia(
  sessionId: string,
  tx: PrismaTransaction
): Promise<number> {
  const result = await rawExecute(
    `UPDATE public.post_media p SET ${erasedMediaFields}
    WHERE p.id IN (SELECT staged.id FROM public.post_media staged WHERE staged."incognitoSessionId"=$1 AND staged.status<>'DELETED'
      ORDER BY staged.id LIMIT 100 FOR UPDATE SKIP LOCKED) AND p."incognitoSessionId"=$1 AND p."postId" IS NULL AND p."commentId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.message_media_links l WHERE l."mediaId"=p.id)`,
    [sessionId],
    tx
  );
  return result.affectedRows;
}

export async function eraseExpiredChatBatch(): Promise<{
  messages: number;
  incognito: number;
  viewOnce: number;
}> {
  const normal = await prisma.transaction(async (tx) => {
    const { rows: conversations } = await rawQuery<{
      id: string;
      changeSeq: number;
    }>(
      `SELECT c.id,c."changeSeq" FROM public.message_conversations c
      WHERE c.id IN (SELECT m."conversationId" FROM public.messages m WHERE m.ciphertext<>'' AND m."expiresAt"<=clock_timestamp() ORDER BY m."expiresAt",m.id LIMIT 100)
      ORDER BY c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,
      [],
      { changeSeq: "pg/int4@1", id: "pg/text@1" },
      tx
    );
    const [conversation] = conversations;
    if (!conversation) {
      return { count: 0, outboxes: [] as string[], users: [] as string[] };
    }
    const { rows } = await rawQuery<{ id: string; revision: number }>(
      `WITH due AS (SELECT id FROM public.messages
      WHERE "conversationId"=$1 AND ciphertext<>'' AND "expiresAt"<=clock_timestamp() ORDER BY "expiresAt",id LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE public.messages m SET "deletedAt"=COALESCE("deletedAt",clock_timestamp()),ciphertext='',iv='',revision=revision+1 FROM due WHERE m.id=due.id RETURNING m.id,m.revision`,
      [conversation.id],
      { id: "pg/text@1", revision: "pg/int4@1" },
      tx
    );
    if (!rows.length) {
      return { count: 0, outboxes: [] as string[], users: [] as string[] };
    }
    const members = await tx.orm.public.MessageConversationMembers.select(
      "userId"
    )
      .where({ conversationId: conversation.id })
      .all();
    const users = members.map((m) => m.userId);
    const outboxes = rows.map(() => crypto.randomUUID());
    await tx.orm.public.MessageSearchOutbox.createAll(
      rows.map((message, offset) => ({
        audienceUserIds: users,
        changeSequence: conversation.changeSeq + offset + 1,
        conversationId: conversation.id,
        id: requireLifecycleValue(outboxes[offset]),
        kind: "delete",
        messageId: message.id,
        revision: message.revision,
      }))
    );
    await tx.orm.public.MessageConversationChanges.createAll(
      rows.map((message, offset) => ({
        audienceUserIds: users,
        conversationId: conversation.id,
        kind: "message.deleted",
        messageId: message.id,
        revision: message.revision,
        sequence: conversation.changeSeq + offset + 1,
      }))
    );
    await eraseMediaReferences(
      "messageId",
      rows.map((r) => r.id),
      tx
    );
    await rawExecute(
      `UPDATE public.message_conversations SET "changeSeq"=$2::integer WHERE id=$1`,
      [conversation.id, conversation.changeSeq + rows.length],
      tx
    );
    await rawExecute(
      `UPDATE public.message_conversation_members SET "unreadCount"=NULL WHERE "conversationId"=$1`,
      [conversation.id],
      tx
    );
    await rawExecute(
      `UPDATE public.message_export_jobs SET status='revoked' WHERE "conversationId"=$1 AND status IN ('pending','processing','ready')`,
      [conversation.id],
      tx
    );
    return { count: rows.length, outboxes, users };
  });
  const incognito = await prisma.transaction(async (tx) => {
    const { rows: sessions } = await rawQuery<{ id: string; ended: boolean }>(
      `SELECT id, ("endedAt" IS NOT NULL) AS ended FROM public.message_incognito_sessions
      WHERE ("endedAt" IS NOT NULL AND "purgedAt" IS NULL)
      OR id IN (SELECT "sessionId" FROM public.message_incognito_messages WHERE "createdAt"<=clock_timestamp()-interval '24 hours' ORDER BY "createdAt",id LIMIT 100)
      ORDER BY "endedAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [],
      { ended: "pg/bool@1", id: "pg/text@1" },
      tx
    );
    const [session] = sessions;
    if (!session) {
      return 0;
    }
    const { rows } = await rawQuery<{ id: string }>(
      `SELECT id FROM public.message_incognito_messages
      WHERE "sessionId"=$1 AND ($2::boolean OR "createdAt"<=clock_timestamp()-interval '24 hours') ORDER BY sequence LIMIT 100 FOR UPDATE SKIP LOCKED`,
      [session.id, session.ended],
      { id: "pg/text@1" },
      tx
    );
    const ids = rows.map((r) => r.id);
    await eraseMediaReferences("incognitoMessageId", ids, tx);
    if (ids.length) {
      await rawExecute(
        `DELETE FROM public.message_incognito_messages WHERE id=ANY($1::text[])`,
        [ids],
        tx
      );
    }
    // Erase unlinked staged uploads for the ended session before marking purged, so a held
    // staged URL cannot survive the session. Idempotent: only rows with no links are touched.
    const staged = session.ended
      ? await eraseStagedIncognitoMedia(session.id, tx)
      : 0;
    await rawExecute(
      `UPDATE public.message_incognito_sessions SET "purgedAt"=clock_timestamp() WHERE id=$1 AND "endedAt" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.message_incognito_messages WHERE "sessionId"=$1)
      AND NOT EXISTS (SELECT 1 FROM public.post_media WHERE "incognitoSessionId"=$1 AND status<>'DELETED')`,
      [session.id],
      tx
    );
    return ids.length + staged + 1;
  });
  // Reservation expiry is retryable; only a transfer that became ACTIVE consumes a photo.
  const released = await rawExecute(
    `WITH due AS (SELECT id FROM public.message_view_once_grants
      WHERE status='RESERVED' AND "expiresAt"<=clock_timestamp()
      ORDER BY "expiresAt",id LIMIT 100 FOR UPDATE SKIP LOCKED)
    DELETE FROM public.message_view_once_grants g USING due WHERE g.id=due.id`
  );
  const expired = await rawExecute(
    `WITH due AS (SELECT id FROM public.message_view_once_grants
      WHERE status='ACTIVE' AND "expiresAt"<=clock_timestamp()
      ORDER BY "expiresAt",id LIMIT 100 FOR UPDATE SKIP LOCKED)
    UPDATE public.message_view_once_grants g SET status='EXPIRED' FROM due WHERE g.id=due.id`
  );
  const { rows: settled } = await rawQuery<{ id: string; mediaLinkId: string }>(
    `SELECT g.id,r."mediaLinkId" FROM public.message_view_once_grants g
      JOIN public.message_view_once_recipients r ON r.id=g."recipientId"
      WHERE g.status IN ('CLOSED','EXPIRED','REVOKED') AND g."expiresAt"<=clock_timestamp()
      ORDER BY g."expiresAt",g.id LIMIT 100`,
    [],
    { id: "pg/text@1", mediaLinkId: "pg/text@1" }
  );
  if (settled.length > 0) {
    // The terminal grant's expiry is a durable cleanup signal until this update succeeds.
    await rawExecute(
      `UPDATE public.message_media_links l SET "deliveryExpiresAt"=LEAST(l."deliveryExpiresAt",clock_timestamp())
        WHERE l.id=ANY($1::text[]) AND l."viewOnce"=true
        AND NOT EXISTS (SELECT 1 FROM public.message_view_once_recipients r WHERE r."mediaLinkId"=l.id
          AND NOT EXISTS (SELECT 1 FROM public.message_view_once_grants g
            WHERE g."recipientId"=r.id AND g.status IN ('CLOSED','EXPIRED','REVOKED')))`,
      [settled.map((row) => row.mediaLinkId)]
    );
    await rawExecute(
      `UPDATE public.message_view_once_grants SET "expiresAt"=NULL
        WHERE id=ANY($1::text[]) AND status IN ('CLOSED','EXPIRED','REVOKED')`,
      [settled.map((row) => row.id)]
    );
  }
  const viewOnce = await prisma.transaction(async (tx) => {
    const { rows } = await rawQuery<{ id: string; mediaId: string }>(
      `SELECT l.id,l."mediaId" FROM public.message_media_links l
      WHERE l."viewOnce"=true AND l."deliveryExpiresAt"<=clock_timestamp()
      ORDER BY l."deliveryExpiresAt",l.id LIMIT 100 FOR UPDATE OF l SKIP LOCKED`,
      [],
      { id: "pg/text@1", mediaId: "pg/text@1" },
      tx
    );
    if (rows.length === 0) {
      return 0;
    }
    const mediaIds = rows.map((row) => row.mediaId);
    const linkIds = rows.map((row) => row.id);
    await rawExecute(
      `UPDATE public.post_media p SET ${erasedMediaFields}
      WHERE p.id=ANY($1::text[]) AND p."messageViewOnce"=true AND p.status<>'DELETED'`,
      [mediaIds],
      tx
    );
    await rawExecute(
      `DELETE FROM public.message_media_links WHERE id=ANY($1::text[])`,
      [linkIds],
      tx
    );
    return rows.length;
  });
  const media = await prisma.orm.public.PostMedia.select("id")
    .where({ failureCode: "CHAT_LIFECYCLE_ERASURE", status: "DELETED" })
    .limit(100)
    .all();
  await Promise.allSettled([
    ...normal.outboxes.map((id) => enqueueMessageSearchOutbox(id)),
    ...media.map((m) => enqueueMediaDeleteCascade(m.id)),
    unreadMessageCache.resetMany(normal.users),
  ]);
  return {
    incognito,
    messages: normal.count,
    viewOnce:
      viewOnce + released.affectedRows + expired.affectedRows + settled.length,
  };
}

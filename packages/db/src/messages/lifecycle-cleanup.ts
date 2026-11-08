import {
  readSqlBundle as readExtractedSqlBundle,
  renderSql as renderExtractedSql,
} from "@asm/db/sql-template";
// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { requireLifecycleValue } from "@asm/messages";

import {
  enqueueMediaDeleteCascade,
  enqueueMessageSearchOutbox,
  unreadMessageCache,
} from "../../queue";
// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers also need the SQL text module declaration.
/// <reference path="../../sql.d.ts" />
import extractedSqlSource from "../../sql/messages/lifecycle-cleanup-lifecycle.sql" with { type: "text" };
import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { rawExecute, rawQuery } from "./infrastructure/raw-sql";

const { extracted: extractedSql } = readExtractedSqlBundle(extractedSqlSource, {
  extracted: [
    "statement1",
    "statement2",
    "statement3",
    "statement4",
    "statement5",
    "statement6",
    "statement7",
    "statement8",
    "statement9",
    "statement10",
    "statement11",
    "statement12",
    "statement13",
    "statement14",
    "statement15",
    "statement16",
    "statement17",
    "statement18",
    "statement19",
    "statement20",
    "statement21",
  ],
} as const);

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
    renderExtractedSql(extractedSql.statement1, { fragment1: field }),
    [ids],
    tx
  );
  await rawExecute(
    renderExtractedSql(extractedSql.statement2, {
      fragment1: erasedMediaFields,
      fragment2: field,
    }),
    [ids],
    tx
  );
  await rawExecute(
    renderExtractedSql(extractedSql.statement3, { fragment1: field }),
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
    renderExtractedSql(extractedSql.statement4, {
      fragment1: erasedMediaFields,
    }),
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
      extractedSql.statement5,
      [],
      { changeSeq: "pg/int4@1", id: "pg/text@1" },
      tx
    );
    const [conversation] = conversations;
    if (!conversation) {
      return { count: 0, outboxes: [] as string[], users: [] as string[] };
    }
    const { rows } = await rawQuery<{ id: string; revision: number }>(
      extractedSql.statement6,
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
      extractedSql.statement7,
      [conversation.id, conversation.changeSeq + rows.length],
      tx
    );
    await rawExecute(extractedSql.statement8, [conversation.id], tx);
    await rawExecute(extractedSql.statement9, [conversation.id], tx);
    return { count: rows.length, outboxes, users };
  });
  const incognito = await prisma.transaction(async (tx) => {
    const { rows: sessions } = await rawQuery<{ id: string; ended: boolean }>(
      extractedSql.statement10,
      [],
      { ended: "pg/bool@1", id: "pg/text@1" },
      tx
    );
    const [session] = sessions;
    if (!session) {
      return 0;
    }
    const { rows } = await rawQuery<{ id: string }>(
      extractedSql.statement11,
      [session.id, session.ended],
      { id: "pg/text@1" },
      tx
    );
    const ids = rows.map((r) => r.id);
    await eraseMediaReferences("incognitoMessageId", ids, tx);
    if (ids.length) {
      await rawExecute(extractedSql.statement12, [ids], tx);
    }
    // Erase unlinked staged uploads for the ended session before marking purged, so a held
    // staged URL cannot survive the session. Idempotent: only rows with no links are touched.
    const staged = session.ended
      ? await eraseStagedIncognitoMedia(session.id, tx)
      : 0;
    await rawExecute(extractedSql.statement13, [session.id], tx);
    return ids.length + staged + 1;
  });
  // Reservation expiry is retryable; only a transfer that became ACTIVE consumes a photo.
  const released = await rawExecute(extractedSql.statement14);
  const expired = await rawExecute(extractedSql.statement15);
  const { rows: settled } = await rawQuery<{ id: string; mediaLinkId: string }>(
    extractedSql.statement16,
    [],
    { id: "pg/text@1", mediaLinkId: "pg/text@1" }
  );
  if (settled.length > 0) {
    // The terminal grant's expiry is a durable cleanup signal until this update succeeds.
    // Floor immediate deadlines to milliseconds so Timestamp(3) cannot round them into the future.
    await rawExecute(extractedSql.statement17, [
      settled.map((row) => row.mediaLinkId),
    ]);
    await rawExecute(extractedSql.statement18, [settled.map((row) => row.id)]);
  }
  const viewOnce = await prisma.transaction(async (tx) => {
    const { rows } = await rawQuery<{ id: string; mediaId: string }>(
      extractedSql.statement19,
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
      renderExtractedSql(extractedSql.statement20, {
        fragment1: erasedMediaFields,
      }),
      [mediaIds],
      tx
    );
    await rawExecute(extractedSql.statement21, [linkIds], tx);
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

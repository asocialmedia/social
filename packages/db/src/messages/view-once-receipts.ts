import { readSqlBundle as readExtractedSqlBundle } from "@asm/db/sql-template";
import type { ViewOnceReceipt } from "@asm/messages";

// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers also need the SQL text module declaration.
/// <reference path="../../sql.d.ts" />
import extractedSqlSource from "../../sql/messages/view-once-receipts-lifecycle.sql" with { type: "text" };
import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { messageInteractionAllowed } from "./access/interaction-access";
import { rawQuery } from "./infrastructure/raw-sql";
import { ChatLifecycleError, lockChatLifecycle } from "./lifecycle";

const { extracted: extractedSql } = readExtractedSqlBundle(extractedSqlSource, {
  extracted: ["statement1", "statement2", "statement3"],
} as const);

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
    extractedSql.statement1,
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
  }>(extractedSql.statement2, [mediaId, userId, target.senderId === userId], {
    seenAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
    unavailable: "pg/bool@1",
  });
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
      extractedSql.statement3,
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

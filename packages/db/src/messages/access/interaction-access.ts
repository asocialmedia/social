import {
  readSqlBundle as readExtractedSqlBundle,
  renderSql as renderExtractedSql,
} from "@asm/db/sql-template";
import { readerMessageWindows } from "@asm/messages";
import type { ReaderMembershipEvent } from "@asm/messages";

// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers also need the SQL text module declaration.
/// <reference path="../../../sql.d.ts" />
import extractedSqlSource from "../../../sql/messages/access/interaction-access-lifecycle.sql" with { type: "text" };
import type { PrismaTransaction } from "../../prisma";
import { readableMessageKeyEpochsSql } from "../epochs/epoch-readability";
import { rawQuery } from "../infrastructure/raw-sql";

const { extracted: extractedSql } = readExtractedSqlBundle(extractedSqlSource, {
  extracted: ["statement1", "statement2", "statement3", "statement4"],
} as const);

// Reactions and private media must obey the same reader boundaries as the transcript.
export async function messageInteractionAllowed(
  input: {
    conversationId: string;
    userId: string;
    messageId: string;
    sessionId?: string;
  },
  tx?: PrismaTransaction
): Promise<boolean> {
  const { conversationId, userId, messageId, sessionId } = input;
  const { rows: members } = await rawQuery<{
    type: "DM" | "DEN";
    createdAt: Date;
  }>(
    extractedSql.statement1,
    [conversationId, userId],
    { createdAt: "pg/timestamp-temporal@1", type: "pg/text@1" },
    tx
  );
  const [member] = members;
  if (!member) {
    return false;
  }
  if (sessionId) {
    const { rows } = await rawQuery<{ allowed: boolean }>(
      renderExtractedSql(extractedSql.statement2, {
        fragment1: readableMessageKeyEpochsSql("$2"),
      }),
      [conversationId, userId, messageId, sessionId],
      { allowed: "pg/bool@1" },
      tx
    );
    return rows[0]?.allowed ?? false;
  }

  let events: ReaderMembershipEvent[] = [];
  if (member.type === "DEN") {
    const result = await rawQuery<ReaderMembershipEvent>(
      extractedSql.statement3,
      [conversationId, userId],
      {
        action: "pg/text@1",
        actorId: { codecId: "pg/text@1", nullable: true },
        createdAt: "pg/timestamp-temporal@1",
        targetUserId: { codecId: "pg/text@1", nullable: true },
      },
      tx
    );
    events = result.rows;
  }
  const windows = readerMessageWindows({
    conversationType: member.type,
    events,
    membership: { createdAt: member.createdAt, leftAt: null },
    userId,
  });
  const { rows } = await rawQuery<{ allowed: boolean }>(
    renderExtractedSql(extractedSql.statement4, {
      fragment1: readableMessageKeyEpochsSql("$2"),
    }),
    [
      conversationId,
      userId,
      messageId,
      JSON.stringify(windows),
      member.type !== "DEN",
    ],
    { allowed: "pg/bool@1" },
    tx
  );
  return rows[0]?.allowed ?? false;
}

import {
  readSqlBundle as readExtractedSqlBundle,
  renderSql as renderExtractedSql,
} from "@asm/db/sql-template";
import { loadReactionCatalog } from "@asm/messages";
import type { MessageReactionSummary } from "@asm/messages";

// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers also need the SQL text module declaration.
/// <reference path="../../sql.d.ts" />
import extractedSqlSource from "../../sql/messages/reactions-lifecycle.sql" with { type: "text" };
import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { messageInteractionAllowed } from "./access/interaction-access";
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
  ],
} as const);

export { QUICK_MESSAGE_REACTIONS as MESSAGE_REACTION_EMOJIS } from "@asm/messages";

export class MessageReactionError extends Error {
  readonly status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.name = "MessageReactionError";
    this.status = status;
  }
}

interface ReactionRow extends MessageReactionSummary {
  messageId: string;
}

export interface MessageReactionTarget {
  conversationId: string;
  messageId: string;
  sessionId?: string;
  userId: string;
}

export async function listMessageReactionSummaries(
  conversationId: string,
  userId: string,
  messageIds: string[],
  incognitoMessageIds: string[] = [],
  tx?: PrismaTransaction
): Promise<Map<string, MessageReactionSummary[]>> {
  const grouped = new Map<string, MessageReactionSummary[]>();
  if (messageIds.length === 0 && incognitoMessageIds.length === 0) {
    return grouped;
  }
  const { rows } = await rawQuery<ReactionRow>(
    extractedSql.statement1,
    [messageIds, incognitoMessageIds, conversationId, userId],
    {
      count: "pg/int4@1",
      emoji: "pg/text@1",
      messageId: "pg/text@1",
      reactedByMe: "pg/bool@1",
    },
    tx
  );
  for (const row of rows) {
    const current = grouped.get(row.messageId) ?? [];
    current.push({
      count: row.count,
      emoji: row.emoji,
      reactedByMe: row.reactedByMe,
    });
    grouped.set(row.messageId, current);
  }
  return grouped;
}

export async function toggleMessageReaction(
  input: MessageReactionTarget & { emoji: string }
): Promise<MessageReactionSummary[]> {
  if (!(await isMessageReactionEmoji(input.emoji))) {
    throw new MessageReactionError("INVALID_EMOJI", 400);
  }
  if (input.messageId.length === 0 || input.messageId.length > 100) {
    throw new MessageReactionError("INVALID_MESSAGE", 400);
  }

  return prisma.transaction(async (tx) => {
    const member = await rawQuery<{ allowed: boolean }>(
      extractedSql.statement2,
      [input.conversationId, input.userId],
      { allowed: "pg/bool@1" },
      tx
    );
    if (!member.rows[0]?.allowed) {
      throw new MessageReactionError("NOT_ALLOWED", 403);
    }

    const source = input.sessionId
      ? {
          column: "incognitoMessageId" as const,
          id: input.messageId,
          sourceId: input.sessionId,
        }
      : { column: "messageId" as const, id: input.messageId, sourceId: null };

    const target =
      source.column === "messageId"
        ? await rawQuery<{ id: string }>(
            extractedSql.statement3,
            [source.id, input.conversationId],
            { id: "pg/text@1" },
            tx
          )
        : await rawQuery<{ id: string }>(
            extractedSql.statement4,
            [source.id, source.sourceId, input.conversationId],
            { id: "pg/text@1" },
            tx
          );
    if (
      target.rows.length === 0 ||
      !(await messageInteractionAllowed(input, tx))
    ) {
      throw new MessageReactionError("MESSAGE_NOT_FOUND", 404);
    }

    const previous = await rawQuery<{ emoji: string }>(
      renderExtractedSql(extractedSql.statement5, { fragment1: source.column }),
      [source.id, input.userId],
      { emoji: "pg/text@1" },
      tx
    );
    const previousEmoji = previous.rows[0]?.emoji ?? null;

    if (previousEmoji === input.emoji) {
      await rawExecute(
        renderExtractedSql(extractedSql.statement6, {
          fragment1: source.column,
        }),
        [source.id, input.userId],
        tx
      );
      await decrementReactionCount(source.column, source.id, previousEmoji, tx);
    } else {
      if (previousEmoji) {
        await decrementReactionCount(
          source.column,
          source.id,
          previousEmoji,
          tx
        );
      }
      await rawExecute(
        renderExtractedSql(extractedSql.statement7, {
          fragment1: source.column,
          fragment2: source.column,
        }),
        [crypto.randomUUID(), source.id, input.userId, input.emoji],
        tx
      );
      await incrementReactionCount(source.column, source.id, input.emoji, tx);
    }

    const summaries = await listMessageReactionSummaries(
      input.conversationId,
      input.userId,
      source.column === "messageId" ? [source.id] : [],
      source.column === "incognitoMessageId" ? [source.id] : [],
      tx
    );
    return summaries.get(source.id) ?? [];
  });
}

export async function isMessageReactionEmoji(value: string): Promise<boolean> {
  if (!value || value.length > 64) {
    return false;
  }
  const catalog = await loadReactionCatalog();
  return catalog.allowed.has(value);
}

async function decrementReactionCount(
  sourceColumn: "messageId" | "incognitoMessageId",
  sourceId: string,
  emoji: string,
  tx: PrismaTransaction
): Promise<void> {
  const deleted = await rawExecute(
    renderExtractedSql(extractedSql.statement8, { fragment1: sourceColumn }),
    [sourceId, emoji],
    tx
  );
  if (deleted.affectedRows > 0) {
    return;
  }
  const updated = await rawExecute(
    renderExtractedSql(extractedSql.statement9, { fragment1: sourceColumn }),
    [sourceId, emoji],
    tx
  );
  if (updated.affectedRows !== 1) {
    throw new Error("Reaction count is inconsistent");
  }
}

async function incrementReactionCount(
  sourceColumn: "messageId" | "incognitoMessageId",
  sourceId: string,
  emoji: string,
  tx: PrismaTransaction
): Promise<void> {
  await rawExecute(
    renderExtractedSql(extractedSql.statement10, {
      fragment1: sourceColumn,
      fragment2: sourceColumn,
    }),
    [crypto.randomUUID(), sourceId, emoji],
    tx
  );
}

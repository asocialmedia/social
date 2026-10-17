import type { MessageReactionSummary } from "@asm/messages";

import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { rawExecute, rawQuery } from "./infrastructure/raw-sql";

export const MESSAGE_REACTION_EMOJIS = [
  "❤️",
  "👍",
  "😂",
  "😮",
  "😢",
  "🔥",
] as const;
export type MessageReactionEmoji = (typeof MESSAGE_REACTION_EMOJIS)[number];

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
    `SELECT COALESCE(r."messageId", r."incognitoMessageId") AS "messageId", r.emoji, r.count,
      EXISTS (SELECT 1 FROM public.message_reactions mine
        WHERE mine."userId"=$4 AND mine.emoji=r.emoji
          AND ((r."messageId" IS NOT NULL AND mine."messageId"=r."messageId")
            OR (r."incognitoMessageId" IS NOT NULL AND mine."incognitoMessageId"=r."incognitoMessageId"))) AS "reactedByMe"
    FROM public.message_reaction_counts r
    LEFT JOIN public.messages m ON m.id=r."messageId"
    LEFT JOIN public.message_incognito_messages im ON im.id=r."incognitoMessageId"
    LEFT JOIN public.message_incognito_sessions s ON s.id=im."sessionId"
    WHERE ((r."messageId"=ANY($1::text[]) AND m."conversationId"=$3)
      OR (r."incognitoMessageId"=ANY($2::text[]) AND s."conversationId"=$3))
    ORDER BY r.count DESC, r.emoji ASC`,
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

export function toggleMessageReaction(
  input: MessageReactionTarget & { emoji: string }
): Promise<MessageReactionSummary[]> {
  if (!isMessageReactionEmoji(input.emoji)) {
    throw new MessageReactionError("INVALID_EMOJI", 400);
  }
  if (input.messageId.length === 0 || input.messageId.length > 100) {
    throw new MessageReactionError("INVALID_MESSAGE", 400);
  }

  return prisma.transaction(async (tx) => {
    const member = await rawQuery<{ allowed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM public.message_conversations c
        JOIN public.message_conversation_members m ON m."conversationId"=c.id
        WHERE c.id=$1 AND m."userId"=$2 AND m."leftAt" IS NULL
        FOR UPDATE OF m) AS allowed`,
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
            `SELECT id FROM public.messages WHERE id=$1 AND "conversationId"=$2 AND "deletedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt">clock_timestamp()) FOR UPDATE`,
            [source.id, input.conversationId],
            { id: "pg/text@1" },
            tx
          )
        : await rawQuery<{ id: string }>(
            `SELECT m.id FROM public.message_incognito_messages m
          JOIN public.message_incognito_sessions s ON s.id=m."sessionId"
          WHERE m.id=$1 AND s.id=$2 AND s."conversationId"=$3 AND s."endedAt" IS NULL
            AND m."createdAt">clock_timestamp()-interval '24 hours'
          FOR UPDATE OF m, s`,
            [source.id, source.sourceId, input.conversationId],
            { id: "pg/text@1" },
            tx
          );
    if (target.rows.length === 0) {
      throw new MessageReactionError("MESSAGE_NOT_FOUND", 404);
    }

    const previous = await rawQuery<{ emoji: string }>(
      `SELECT emoji FROM public.message_reactions WHERE "${source.column}"=$1 AND "userId"=$2 FOR UPDATE`,
      [source.id, input.userId],
      { emoji: "pg/text@1" },
      tx
    );
    const previousEmoji = previous.rows[0]?.emoji ?? null;

    if (previousEmoji === input.emoji) {
      await rawExecute(
        `DELETE FROM public.message_reactions WHERE "${source.column}"=$1 AND "userId"=$2`,
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
        `INSERT INTO public.message_reactions (id,"${source.column}","userId",emoji)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT ("${source.column}","userId") DO UPDATE SET emoji=EXCLUDED.emoji`,
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

export function isMessageReactionEmoji(
  value: string
): value is MessageReactionEmoji {
  return MESSAGE_REACTION_EMOJIS.some((emoji) => emoji === value);
}

async function decrementReactionCount(
  sourceColumn: "messageId" | "incognitoMessageId",
  sourceId: string,
  emoji: string,
  tx: PrismaTransaction
): Promise<void> {
  const deleted = await rawExecute(
    `DELETE FROM public.message_reaction_counts WHERE "${sourceColumn}"=$1 AND emoji=$2 AND count=1`,
    [sourceId, emoji],
    tx
  );
  if (deleted.affectedRows > 0) {
    return;
  }
  const updated = await rawExecute(
    `UPDATE public.message_reaction_counts SET count=count-1
      WHERE "${sourceColumn}"=$1 AND emoji=$2 AND count>1`,
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
    `INSERT INTO public.message_reaction_counts (id,"${sourceColumn}",emoji,count)
      VALUES ($1,$2,$3,1)
      ON CONFLICT ("${sourceColumn}",emoji) DO UPDATE SET count=public.message_reaction_counts.count+1`,
    [crypto.randomUUID(), sourceId, emoji],
    tx
  );
}

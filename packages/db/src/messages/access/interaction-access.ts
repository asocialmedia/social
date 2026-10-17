import { readerMessageWindows } from "@asm/messages";
import type { ReaderMembershipEvent } from "@asm/messages";

import type { PrismaTransaction } from "../../prisma";
import { readableMessageKeyEpochsSql } from "../epochs/epoch-readability";
import { rawQuery } from "../infrastructure/raw-sql";

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
    `SELECT c.type::text AS type,v."createdAt" FROM public.message_conversations c
      JOIN public.message_conversation_members v ON v."conversationId"=c.id AND v."userId"=$2
      WHERE c.id=$1 AND v."leftAt" IS NULL
      AND (c.type='DEN' OR NOT EXISTS (
        SELECT 1 FROM public.message_conversation_members peer JOIN public.blocks b
          ON (b."blockerId"=$2 AND b."blockedId"=peer."userId")
            OR (b."blockedId"=$2 AND b."blockerId"=peer."userId")
        WHERE peer."conversationId"=c.id AND peer."userId"<>$2))`,
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
      `SELECT EXISTS (SELECT 1 FROM public.message_incognito_messages m
        JOIN public.message_incognito_sessions s ON s.id=m."sessionId"
        WHERE m.id=$3 AND s.id=$4 AND s."conversationId"=$1 AND s."endedAt" IS NULL
          AND m."createdAt">clock_timestamp()-interval '24 hours'
          AND (NOT EXISTS(SELECT 1 FROM public.message_search_account_state a WHERE a."userId"=$2 AND a."recoveryGeneration">0)
            OR m."keyEpoch" IN (${readableMessageKeyEpochsSql("$2")}))) AS allowed`,
      [conversationId, userId, messageId, sessionId],
      { allowed: "pg/bool@1" },
      tx
    );
    return rows[0]?.allowed ?? false;
  }

  let events: ReaderMembershipEvent[] = [];
  if (member.type === "DEN") {
    const result = await rawQuery<ReaderMembershipEvent>(
      `SELECT action::text AS action,"actorId","targetUserId","createdAt"
          FROM public.message_conversation_membership_events
          WHERE "conversationId"=$1 AND COALESCE("targetUserId","actorId")=$2
          AND action IN ('CREATED','JOINED','LEFT','REMOVED') ORDER BY "createdAt",id`,
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
    `SELECT EXISTS (SELECT 1 FROM public.messages m
      JOIN public.message_conversation_members v ON v."conversationId"=m."conversationId" AND v."userId"=$2
      WHERE m.id=$3 AND m."conversationId"=$1 AND m."deletedAt" IS NULL
        AND (m."expiresAt" IS NULL OR m."expiresAt">clock_timestamp())
        AND (m."creationSequence">v."clearedThroughSequence" OR (m."creationSequence"=0 AND (v."clearedAt" IS NULL OR m."createdAt">v."clearedAt")))
        AND NOT EXISTS (SELECT 1 FROM public.message_hidden h WHERE h."messageId"=m.id AND h."userId"=$2)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements($4::jsonb) w
          WHERE (w->>'after' IS NULL OR m."createdAt">=(w->>'after')::timestamp)
            AND (w->>'before' IS NULL OR m."createdAt"<=(w->>'before')::timestamp))
        AND ($5::boolean OR EXISTS (SELECT 1 FROM public.message_conversation_keys k
          WHERE k."conversationId"=$1 AND k."ownerUserId"=$2 AND k.version=m."keyEpoch"))
        AND (NOT EXISTS(SELECT 1 FROM public.message_search_account_state a WHERE a."userId"=$2 AND a."recoveryGeneration">0)
          OR m."keyEpoch" IN (${readableMessageKeyEpochsSql("$2")}))) AS allowed`,
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

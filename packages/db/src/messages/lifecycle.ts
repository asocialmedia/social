// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import {
  requireLifecycleValue,
  CHAT_DAY_MS,
  readerMessageWindows,
} from "@asm/messages";
import type {
  ChatLifecycleSnapshot,
  IncognitoMessage,
  IncognitoSession,
} from "@asm/messages";

import { fromPrismaDateTime } from "../dates";
import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { listDenMembershipEvents } from "./dens/den-service";
import { readableMessageKeyEpochsSql } from "./epochs/epoch-readability";
import { rawExecute, rawQuery } from "./infrastructure/raw-sql";

export class ChatLifecycleError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.name = "ChatLifecycleError";
    this.code = code;
    this.status = status;
  }
}

interface AccessRow {
  type: string;
  role: string;
  leftAt: Date | null;
  displayName: string;
  retentionSeconds: number;
  retentionVersion: number;
  changeSeq: number;
  clearedThroughSequence: number;
  clearedAt: Date | null;
}
const accessSpec = {
  changeSeq: "pg/int4@1",
  clearedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
  clearedThroughSequence: "pg/int4@1",
  displayName: "pg/text@1",
  leftAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
  retentionSeconds: "pg/int4@1",
  retentionVersion: "pg/int4@1",
  role: "pg/text@1",
  type: "pg/text@1",
} as const;

export async function lockChatLifecycle(
  conversationId: string,
  userId: string,
  tx: PrismaTransaction
): Promise<AccessRow> {
  const { rows } = await rawQuery<AccessRow>(
    `SELECT c.type::text AS type, m.role::text AS role, m."leftAt", u."displayName",
    c."retentionSeconds", c."retentionVersion", c."changeSeq", m."clearedThroughSequence", m."clearedAt"
    FROM public.message_conversations c JOIN public.message_conversation_members m ON m."conversationId"=c.id AND m."userId"=$2
    JOIN public.users u ON u.id=m."userId" WHERE c.id=$1 FOR UPDATE OF c`,
    [conversationId, userId],
    accessSpec,
    tx
  );
  const [row] = rows;
  if (!row) {
    throw new ChatLifecycleError("CHAT_NOT_FOUND", 404);
  }
  return row;
}

function sessionDto(
  row: NonNullable<
    Awaited<ReturnType<typeof prisma.orm.public.MessageIncognitoSessions.first>>
  >
): IncognitoSession {
  return {
    ...row,
    endedAt: row.endedAt ? fromPrismaDateTime(row.endedAt).toISOString() : null,
    expiresAt: fromPrismaDateTime(row.expiresAt).toISOString(),
    startedAt: fromPrismaDateTime(row.startedAt).toISOString(),
  };
}

export async function chatLifecycleSnapshot(
  conversationId: string,
  userId: string,
  before?: string
): Promise<ChatLifecycleSnapshot> {
  const member = await prisma.orm.public.MessageConversationMembers.where({
    conversationId,
    userId,
  }).first();
  const conversation = await prisma.orm.public.MessageConversations.where({
    id: conversationId,
  }).first();
  if (!member || !conversation) {
    throw new ChatLifecycleError("CHAT_NOT_FOUND", 404);
  }
  let notices = prisma.orm.public.MessageIncognitoSessions.where({
    conversationId,
  }).orderBy([(s) => s.startedAt.desc(), (s) => s.id.desc()]);
  if (before) {
    const anchor = await prisma.orm.public.MessageIncognitoSessions.where({
      conversationId,
      id: before,
    }).first();
    if (!anchor) {
      throw new ChatLifecycleError("INVALID_CURSOR", 400);
    }
    notices = notices.cursor({ id: anchor.id, startedAt: anchor.startedAt });
  }
  const [sessions, active] = await Promise.all([
    notices.limit(21).all(),
    prisma.orm.public.MessageIncognitoSessions.where((s) =>
      s.conversationId.eq(conversationId)
    )
      .where((s) => s.endedAt.isNull())
      .first(),
  ]);
  const { rows: clockRows } = await rawQuery<{ now: Date }>(
    `SELECT clock_timestamp() AS now`,
    [],
    { now: "pg/timestamp-temporal@1" }
  );
  const { now } = requireLifecycleValue(clockRows[0]);
  const cards = sessions
    .slice(0, 20)
    .map(sessionDto)
    .map((s) =>
      !s.endedAt && Date.parse(s.expiresAt) <= now.getTime()
        ? { ...s, endReason: "timeout", endedAt: s.expiresAt }
        : s
    );
  return {
    activeSession:
      active && fromPrismaDateTime(active.expiresAt) > now
        ? sessionDto(active)
        : null,
    changeSeq: conversation.changeSeq,
    clearedAt: member.clearedAt
      ? fromPrismaDateTime(member.clearedAt).toISOString()
      : null,
    clearedThroughSequence: member.clearedThroughSequence,
    nextNoticeCursor: sessions.length > 20 ? (cards.at(-1)?.id ?? null) : null,
    notices: cards,
    retentionSeconds: conversation.retentionSeconds,
    retentionVersion: conversation.retentionVersion,
    serverNow: now.toISOString(),
  };
}

export async function startIncognito(
  conversationId: string,
  userId: string,
  clientActionId?: string
): Promise<void> {
  await prisma.transaction(async (tx) => {
    const access = await lockChatLifecycle(conversationId, userId, tx);
    if (access.type !== "DM" || access.leftAt) {
      throw new ChatLifecycleError("INCOGNITO_DM_ONLY", 403);
    }
    await rawExecute(
      `UPDATE public.message_incognito_sessions SET "endedAt"="expiresAt", "endReason"='timeout'
      WHERE "conversationId"=$1 AND "endedAt" IS NULL AND "expiresAt"<=clock_timestamp()`,
      [conversationId],
      tx
    );
    // Idempotent retries share a stable client action ID: a delayed retry after the session ended
    // must not start an unintended new session, so a known action ID returns its session as-is.
    if (clientActionId !== undefined) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          clientActionId
        )
      ) {
        throw new ChatLifecycleError("INVALID_ACTION", 400);
      }
      const known = await tx.orm.public.MessageIncognitoSessions.where({
        id: clientActionId,
      }).first();
      if (known && known.conversationId !== conversationId) {
        throw new ChatLifecycleError("INVALID_ACTION", 400);
      }
      if (known) {
        return;
      }
    }
    const existing = await tx.orm.public.MessageIncognitoSessions.where({
      conversationId,
    })
      .where((s) => s.endedAt.isNull())
      .first();
    if (existing) {
      return;
    }
    const sessionId = clientActionId ?? crypto.randomUUID();
    await rawExecute(
      `INSERT INTO public.message_incognito_sessions
      (id,"conversationId","startedById","startedByName","startedAt","expiresAt","nextSequence")
      VALUES ($1,$2,$3,$4,statement_timestamp(),statement_timestamp()+interval '24 hours',0)
      ON CONFLICT (id) DO NOTHING`,
      [sessionId, conversationId, userId, access.displayName],
      tx
    );
    await rawExecute(
      `UPDATE public.message_conversations SET "retentionVersion"="retentionVersion"+1,"updatedAt"=clock_timestamp() WHERE id=$1`,
      [conversationId],
      tx
    );
  });
}

export async function endIncognito(
  conversationId: string,
  userId: string,
  sessionId: string
): Promise<void> {
  await prisma.transaction(async (tx) => {
    const access = await lockChatLifecycle(conversationId, userId, tx);
    const target = await tx.orm.public.MessageIncognitoSessions.where({
      conversationId,
      id: sessionId,
    }).first();
    if (!target) {
      throw new ChatLifecycleError("CHAT_NOT_FOUND", 404);
    }
    if (target.endedAt) {
      return;
    }
    await rawExecute(
      `UPDATE public.message_incognito_sessions SET
      "endedAt"=LEAST(clock_timestamp(),"expiresAt"),
      "endReason"=CASE WHEN "expiresAt"<=clock_timestamp() THEN 'timeout' ELSE 'manual' END,
      "endedById"=CASE WHEN "expiresAt">clock_timestamp() THEN $3 ELSE NULL END,
      "endedByName"=CASE WHEN "expiresAt">clock_timestamp() THEN $4 ELSE NULL END
      WHERE id=$1 AND "conversationId"=$2 AND "endedAt" IS NULL`,
      [sessionId, conversationId, userId, access.displayName],
      tx
    );
    await rawExecute(
      `UPDATE public.message_conversations SET "retentionVersion"="retentionVersion"+1 WHERE id=$1`,
      [conversationId],
      tx
    );
  });
}

export async function changeChatRetention(
  conversationId: string,
  userId: string,
  retentionSeconds: number,
  expectedVersion: number
): Promise<void> {
  if (retentionSeconds !== 0 && retentionSeconds !== CHAT_DAY_MS / 1000) {
    throw new ChatLifecycleError("INVALID_RETENTION", 400);
  }
  await prisma.transaction(async (tx) => {
    const access = await lockChatLifecycle(conversationId, userId, tx);
    if (access.leftAt || (access.type === "DEN" && access.role === "MEMBER")) {
      throw new ChatLifecycleError("RETENTION_FORBIDDEN", 403);
    }
    if (access.retentionVersion !== expectedVersion) {
      throw new ChatLifecycleError("CHAT_STATE_CHANGED");
    }
    await rawExecute(
      `UPDATE public.message_conversations SET "retentionSeconds"=$2::integer, "retentionVersion"="retentionVersion"+1 WHERE id=$1`,
      [conversationId, retentionSeconds],
      tx
    );
  });
}

export async function clearChatHistory(
  conversationId: string,
  userId: string,
  throughSequence?: number
): Promise<void> {
  await prisma.transaction(async (tx) => {
    const access = await lockChatLifecycle(conversationId, userId, tx);
    // Database-clock gate so skewed app clocks cannot clear during an active session.
    const { rows: activeRows } = await rawQuery<{ id: string }>(
      `SELECT id FROM public.message_incognito_sessions WHERE "conversationId"=$1 AND "endedAt" IS NULL AND "expiresAt">clock_timestamp() LIMIT 1`,
      [conversationId],
      { id: "pg/text@1" },
      tx
    );
    if (activeRows.length > 0) {
      throw new ChatLifecycleError("END_INCOGNITO_FIRST");
    }
    // Snapshot-bounded clear: an uncertain retry replays the original boundary instead of
    // clearing messages that arrived after the user's confirmation.
    let boundary = access.changeSeq;
    if (throughSequence !== undefined) {
      if (!Number.isSafeInteger(throughSequence) || throughSequence < 0) {
        throw new ChatLifecycleError("INVALID_CLEAR", 400);
      }
      if (throughSequence > access.changeSeq) {
        throw new ChatLifecycleError("CHAT_STATE_CHANGED");
      }
      boundary = throughSequence;
    }
    // A delayed retry must never restore previously cleared history or hide newer arrivals.
    if (access.clearedAt && boundary <= access.clearedThroughSequence) {
      return;
    }
    boundary = Math.max(boundary, access.clearedThroughSequence);
    await rawExecute(
      `UPDATE public.message_conversation_members SET "clearedThroughSequence"=$3::integer,"clearedAt"=clock_timestamp(),
      "inboxHiddenAt"=CASE WHEN $4::integer>$3::integer THEN NULL ELSE clock_timestamp() END,
      "lastReadSequence"=GREATEST(COALESCE("lastReadSequence",0),$3::integer),"lastReadAt"=clock_timestamp(),"unreadCount"=NULL
      WHERE "conversationId"=$1 AND "userId"=$2`,
      [conversationId, userId, boundary, access.changeSeq],
      tx
    );
    await rawExecute(
      `UPDATE public.message_export_jobs SET status='revoked' WHERE "conversationId"=$1 AND "userId"=$2 AND status IN ('pending','processing','ready')`,
      [conversationId, userId],
      tx
    );
  });
}

export async function guardNormalChatSend(
  conversationId: string,
  userId: string,
  expectedVersion: unknown,
  tx: PrismaTransaction
): Promise<{ expiresAt: Date | null }> {
  const access = await lockChatLifecycle(conversationId, userId, tx);
  // Database-clock predicate so skewed app clocks cannot admit a normal send after activation.
  const { rows: activeRows } = await rawQuery<{ id: string }>(
    `SELECT id FROM public.message_incognito_sessions WHERE "conversationId"=$1 AND "endedAt" IS NULL AND "expiresAt">clock_timestamp() LIMIT 1`,
    [conversationId],
    { id: "pg/text@1" },
    tx
  );
  if (activeRows.length > 0) {
    throw new ChatLifecycleError("INCOGNITO_ACTIVE");
  }
  if (
    (expectedVersion === undefined && access.retentionVersion !== 0) ||
    (expectedVersion !== undefined &&
      expectedVersion !== access.retentionVersion)
  ) {
    throw new ChatLifecycleError("CHAT_STATE_CHANGED");
  }
  if (!access.retentionSeconds) {
    return { expiresAt: null };
  }
  const { rows: clockRows } = await rawQuery<{ now: Date }>(
    `SELECT clock_timestamp() AS now`,
    [],
    { now: { codecId: "pg/timestamp-temporal@1", nullable: false } },
    tx
  );
  const now = clockRows[0]?.now
    ? fromPrismaDateTime(clockRows[0].now).getTime()
    : Date.now();
  return { expiresAt: new Date(now + access.retentionSeconds * 1000) };
}

export async function sendIncognitoMessage(input: {
  id: string;
  conversationId: string;
  sessionId: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  ratchetIndex: number;
  keyEpoch: number;
  mediaIds: string[];
}): Promise<void> {
  await prisma.transaction(async (tx) => {
    const access = await lockChatLifecycle(
      input.conversationId,
      input.senderId,
      tx
    );
    if (access.type !== "DM" || access.leftAt) {
      throw new ChatLifecycleError("INCOGNITO_DM_ONLY", 403);
    }
    const session = await tx.orm.public.MessageIncognitoSessions.where({
      conversationId: input.conversationId,
      id: input.sessionId,
    }).first();
    const active = await rawQuery<{ active: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM public.message_incognito_sessions WHERE id=$1 AND "conversationId"=$2 AND "endedAt" IS NULL AND "expiresAt">clock_timestamp()) AS active`,
      [input.sessionId, input.conversationId],
      { active: "pg/bool@1" },
      tx
    );
    if (!session || !active.rows[0]?.active) {
      throw new ChatLifecycleError("INCOGNITO_ENDED", 410);
    }
    const existing = await tx.orm.public.MessageIncognitoMessages.where({
      id: input.id,
    }).first();
    if (existing) {
      if (
        existing.sessionId !== input.sessionId ||
        existing.senderId !== input.senderId
      ) {
        throw new ChatLifecycleError("INVALID_MESSAGE_ID", 400);
      }
      return;
    }
    if (session.nextSequence !== input.ratchetIndex) {
      throw new ChatLifecycleError(`INCOGNITO_INDEX:${session.nextSequence}`);
    }
    const key = await tx.orm.public.MessageConversationKeys.where({
      conversationId: input.conversationId,
      ownerUserId: input.senderId,
      version: input.keyEpoch,
    }).first();
    if (!key) {
      throw new ChatLifecycleError("MESSAGE_KEY_UNAVAILABLE", 403);
    }
    const accepted = await rawExecute(
      `INSERT INTO public.message_incognito_messages (id,"sessionId","senderId",ciphertext,iv,"keyEpoch","ratchetIndex",sequence,"createdAt")
      SELECT $1,$2,$3,$4,$5,$6::integer,$7::integer,$7::integer,clock_timestamp()
      FROM public.message_incognito_sessions WHERE id=$2 AND "endedAt" IS NULL AND "expiresAt">clock_timestamp()`,
      [
        input.id,
        input.sessionId,
        input.senderId,
        input.ciphertext,
        input.iv,
        input.keyEpoch,
        input.ratchetIndex,
      ],
      tx
    );
    if (accepted.affectedRows !== 1) {
      throw new ChatLifecycleError("INCOGNITO_ENDED", 410);
    }
    await linkLifecycleMedia(
      {
        conversationId: input.conversationId,
        incognitoMessageId: input.id,
        mediaIds: input.mediaIds,
        protect: true,
        userId: input.senderId,
      },
      tx
    );
    await rawExecute(
      `UPDATE public.message_incognito_sessions SET "nextSequence"="nextSequence"+1 WHERE id=$1`,
      [input.sessionId],
      tx
    );
  });
}

export async function listIncognitoMessages(
  conversationId: string,
  userId: string,
  sessionId: string,
  beforeSequence?: number
): Promise<{ messages: IncognitoMessage[]; hasMore: boolean }> {
  const member = await prisma.orm.public.MessageConversationMembers.where({
    conversationId,
    userId,
  }).first();
  if (!member) {
    throw new ChatLifecycleError("CHAT_NOT_FOUND", 404);
  }
  const { rows } = await rawQuery<{ data: IncognitoMessage }>(
    `SELECT jsonb_build_object('id',m.id,'sessionId',m."sessionId",'senderId',m."senderId",'ciphertext',m.ciphertext,'iv',m.iv,
      'keyEpoch',m."keyEpoch",'ratchetIndex',m."ratchetIndex",'sequence',m.sequence,'createdAt',to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS data
    FROM public.message_incognito_messages m JOIN public.message_incognito_sessions s ON s.id=m."sessionId"
    WHERE s.id=$1 AND s."conversationId"=$2 AND s."endedAt" IS NULL AND s."expiresAt">clock_timestamp()
    AND ($3::integer IS NULL OR m.sequence<$3::integer) ORDER BY m.sequence DESC LIMIT 51`,
    [sessionId, conversationId, beforeSequence ?? null],
    { data: "pg/jsonb@1" }
  );
  // Bound response bytes as well as row count: 50 rows of 64 KiB ciphertext could exceed 3 MiB,
  // so trim oldest-first to a 1 MiB ciphertext ceiling and report truncation via hasMore.
  const ceiling = 1024 * 1024;
  let bytes = 0;
  const newestFirst = rows.slice(0, 50).map((r) => r.data);
  const keptNewestFirst: IncognitoMessage[] = [];
  for (const message of newestFirst) {
    bytes += message.ciphertext.length + message.iv.length;
    if (bytes > ceiling && keptNewestFirst.length > 0) {
      break;
    }
    keptNewestFirst.push(message);
  }
  const truncated = keptNewestFirst.length < newestFirst.length;
  return {
    hasMore: rows.length > 50 || truncated,
    messages: keptNewestFirst.toReversed(),
  };
}

export async function linkLifecycleMedia(
  input: {
    conversationId: string;
    userId: string;
    messageId?: string;
    incognitoMessageId?: string;
    mediaIds: string[];
    protect: boolean;
  },
  tx: PrismaTransaction
): Promise<void> {
  const hasNormal = Boolean(input.messageId);
  const hasIncognito = Boolean(input.incognitoMessageId);
  if (hasNormal === hasIncognito) {
    throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
  }
  let incognitoSessionId: string | null = null;
  if (hasIncognito) {
    const target = await tx.orm.public.MessageIncognitoMessages.where({
      id: requireLifecycleValue(input.incognitoMessageId),
    }).first();
    if (!target) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    const session = await tx.orm.public.MessageIncognitoSessions.where({
      id: target.sessionId,
    }).first();
    if (!session || session.conversationId !== input.conversationId) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    incognitoSessionId = session.id;
  } else {
    const target = await tx.orm.public.Messages.where({
      id: requireLifecycleValue(input.messageId),
    }).first();
    if (!target || target.conversationId !== input.conversationId) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
  }
  for (const mediaId of new Set(input.mediaIds)) {
    const media = await tx.orm.public.PostMedia.where({ id: mediaId }).first();
    if (
      !media ||
      media.userId !== input.userId ||
      media.messageConversationId !== input.conversationId ||
      media.postId ||
      media.commentId
    ) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    // Only scanned content may be attached; quarantined or uploading rows stay invisible until READY.
    if (media.status !== "READY") {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    if (hasIncognito) {
      // An incognito asset must belong to exactly the target session; a staged row without a session
      // is bound here, a mismatched row is rejected so sessions cannot cross-link.
      if (media.incognitoSessionId !== incognitoSessionId) {
        throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
      }
    } else if (media.incognitoSessionId !== null) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    await tx.orm.public.PostMedia.where({ id: mediaId }).update({
      incognitoSessionId: hasIncognito
        ? incognitoSessionId
        : media.incognitoSessionId,
      messageLifecycleProtected: true,
    });
    await tx.orm.public.MessageMediaLinks.create({
      incognitoMessageId: input.incognitoMessageId ?? null,
      mediaId,
      messageId: input.messageId ?? null,
    });
  }
}

export async function lifecycleMediaAllowed(
  mediaId: string,
  viewerId: string,
  options: { allowProcessing?: boolean } = {}
): Promise<boolean | null> {
  const media = await prisma.orm.public.PostMedia.select(
    "messageLifecycleProtected",
    "status",
    "incognitoSessionId",
    "userId",
    "messageConversationId",
    "createdAt"
  )
    .where({ id: mediaId })
    .first();
  if (!media) {
    return null;
  }
  if (!media.messageLifecycleProtected) {
    if (media.messageConversationId) {
      const viewer = await prisma.orm.public.MessageConversationMembers.where({
        conversationId: media.messageConversationId,
        userId: viewerId,
      }).first();
      if (
        !viewer ||
        (viewer.clearedAt &&
          fromPrismaDateTime(media.createdAt) <=
            fromPrismaDateTime(viewer.clearedAt))
      ) {
        return false;
      }
    }
    return null;
  }
  // Unscanned or erased rows are never served, even to the uploader.
  if (
    media.status !== "READY" &&
    !(
      options.allowProcessing &&
      media.userId === viewerId &&
      ["UPLOADING", "QUARANTINED", "SCANNING", "PROCESSING"].includes(
        media.status
      )
    )
  ) {
    return false;
  }
  const { rows: linkRows } = await rawQuery<{ count: number }>(
    `SELECT COUNT(*)::integer AS count FROM public.message_media_links WHERE "mediaId"=$1`,
    [mediaId],
    { count: "pg/int4@1" }
  );
  if ((linkRows[0]?.count ?? 0) === 0) {
    // Staged upload with no message link yet: only the uploader may preview it, and an incognito
    // staged row additionally requires its session to still be active so an ended session cannot
    // be revived by holding a staged URL.
    if (media.userId !== viewerId) {
      return false;
    }
    if (media.incognitoSessionId !== null) {
      const { rows } = await rawQuery<{ allowed: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM public.message_incognito_sessions s
          JOIN public.message_conversation_members v ON v."conversationId"=s."conversationId" AND v."userId"=$2 AND v."leftAt" IS NULL
          WHERE s.id=$1 AND s."endedAt" IS NULL AND s."expiresAt">clock_timestamp()) AS allowed`,
        [media.incognitoSessionId, viewerId],
        { allowed: "pg/bool@1" }
      );
      return rows[0]?.allowed ?? false;
    }
    if (media.messageConversationId === null) {
      return false;
    }
    const { rows } = await rawQuery<{ allowed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM public.message_conversation_members v
        WHERE v."conversationId"=$1 AND v."userId"=$2 AND v."leftAt" IS NULL) AS allowed`,
      [media.messageConversationId, viewerId],
      { allowed: "pg/bool@1" }
    );
    return rows[0]?.allowed ?? false;
  }
  const conversation = media.messageConversationId
    ? await prisma.orm.public.MessageConversations.where({
        id: media.messageConversationId,
      }).first()
    : null;
  const member = conversation
    ? await prisma.orm.public.MessageConversationMembers.where({
        conversationId: conversation.id,
        userId: viewerId,
      }).first()
    : null;
  if (!conversation || !member) {
    return false;
  }
  const events =
    conversation._type === "DEN"
      ? await listDenMembershipEvents(
          conversation.id,
          member.leftAt ? fromPrismaDateTime(member.leftAt) : null
        )
      : [];
  const windows = readerMessageWindows({
    conversationType: conversation._type,
    events,
    membership: {
      createdAt: fromPrismaDateTime(member.createdAt),
      leftAt: member.leftAt ? fromPrismaDateTime(member.leftAt) : null,
    },
    userId: viewerId,
  });
  const { rows } = await rawQuery<{ allowed: boolean }>(
    `SELECT EXISTS (
    SELECT 1 FROM public.message_media_links l JOIN public.messages m ON m.id=l."messageId"
    JOIN public.message_conversation_members v ON v."conversationId"=m."conversationId" AND v."userId"=$2
    JOIN public.post_media p ON p.id=l."mediaId"
    WHERE l."mediaId"=$1 AND p."incognitoSessionId" IS NULL AND m."deletedAt" IS NULL AND (m."expiresAt" IS NULL OR m."expiresAt">clock_timestamp())
    AND ((m."creationSequence">v."clearedThroughSequence") OR (m."creationSequence"=0 AND (v."clearedAt" IS NULL OR m."createdAt">v."clearedAt")))
    AND EXISTS (SELECT 1 FROM jsonb_array_elements($3::jsonb) w
      WHERE (w->>'after' IS NULL OR m."createdAt">=(w->>'after')::timestamp)
      AND (w->>'before' IS NULL OR m."createdAt"<=(w->>'before')::timestamp))
    AND ($4::boolean OR EXISTS (SELECT 1 FROM public.message_conversation_keys k
      WHERE k."conversationId"=m."conversationId" AND k."ownerUserId"=$2 AND k.version=m."keyEpoch"))
    AND (NOT EXISTS(SELECT 1 FROM public.message_search_account_state a WHERE a."userId"=$2 AND a."recoveryGeneration">0)
      OR m."keyEpoch" IN (${readableMessageKeyEpochsSql("$2").replace('epoch_key."conversationId" = $1', 'epoch_key."conversationId" = $5')}))
    AND NOT EXISTS (SELECT 1 FROM public.message_hidden h WHERE h."messageId"=m.id AND h."userId"=$2)
    UNION ALL SELECT 1 FROM public.message_media_links l JOIN public.message_incognito_messages m ON m.id=l."incognitoMessageId"
    JOIN public.message_incognito_sessions s ON s.id=m."sessionId"
    JOIN public.message_conversation_members v ON v."conversationId"=s."conversationId" AND v."userId"=$2 AND v."leftAt" IS NULL
    JOIN public.post_media p ON p.id=l."mediaId"
    WHERE l."mediaId"=$1 AND p."incognitoSessionId"=s.id
    AND s."endedAt" IS NULL AND s."expiresAt">clock_timestamp()
    AND (NOT EXISTS(SELECT 1 FROM public.message_search_account_state a WHERE a."userId"=$2 AND a."recoveryGeneration">0)
      OR m."keyEpoch" IN (${readableMessageKeyEpochsSql("$2").replace('epoch_key."conversationId" = $1', 'epoch_key."conversationId" = $5')}))
    ) AS allowed`,
    [
      mediaId,
      viewerId,
      JSON.stringify(windows),
      conversation._type !== "DEN",
      conversation.id,
    ],
    { allowed: "pg/bool@1" }
  );
  return rows[0]?.allowed ?? false;
}

export async function publishChatLifecycleChange(
  conversationId: string,
  contentOnly = false
): Promise<void> {
  try {
    const { redis } = await import("../redis");
    await redis.publish(
      `chat-lifecycle:${conversationId}`,
      contentOnly ? "message" : "changed"
    );
  } catch {
    // Reconcile safely on the next request; do not expose source errors.
    // Clients reconcile on foreground and on a bounded fallback interval.
  }
}

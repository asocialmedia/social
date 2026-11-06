import {
  readSqlBundle as readExtractedSqlBundle,
  renderSql as renderExtractedSql,
} from "@asm/db/sql-template";
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

// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers also need the SQL text module declaration.
/// <reference path="../../sql.d.ts" />
import extractedSqlSource from "../../sql/messages/lifecycle-lifecycle.sql" with { type: "text" };
import { fromPrismaDateTime, toPrismaDateTime } from "../dates";
import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
import { messageInteractionAllowed } from "./access/interaction-access";
import { listDenMembershipEvents } from "./dens/den-service";
import { readableMessageKeyEpochsSql } from "./epochs/epoch-readability";
import { rawExecute, rawQuery } from "./infrastructure/raw-sql";
import { listMessageReactionSummaries } from "./reactions";

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
    "statement22",
    "statement23",
    "statement24",
    "statement25",
    "statement26",
    "statement27",
    "statement28",
    "statement29",
    "statement30",
    "statement31",
    "statement32",
  ],
} as const);

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
    extractedSql.statement1,
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
    // Retained as a nullable wire field for older snapshots; sessions now end explicitly.
    expiresAt: null,
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
    extractedSql.statement2,
    [],
    { now: "pg/timestamp-temporal@1" }
  );
  const { now } = requireLifecycleValue(clockRows[0]);
  const cards = sessions.slice(0, 20).map(sessionDto);
  return {
    activeSession: active ? sessionDto(active) : null,
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
      extractedSql.statement3,
      [sessionId, conversationId, userId, access.displayName],
      tx
    );
    await rawExecute(extractedSql.statement4, [conversationId], tx);
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
      extractedSql.statement5,
      [sessionId, conversationId, userId, access.displayName],
      tx
    );
    await rawExecute(extractedSql.statement6, [conversationId], tx);
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
      extractedSql.statement7,
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
      extractedSql.statement8,
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
      extractedSql.statement9,
      [conversationId, userId, boundary, access.changeSeq],
      tx
    );
    await rawExecute(extractedSql.statement10, [conversationId, userId], tx);
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
    extractedSql.statement11,
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
    extractedSql.statement12,
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
  viewOnceMediaIds?: string[];
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
      extractedSql.statement13,
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
      extractedSql.statement14,
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
        viewOnceMediaIds: input.viewOnceMediaIds,
      },
      tx
    );
    await rawExecute(extractedSql.statement15, [input.sessionId], tx);
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
    extractedSql.statement16,
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
  const messages = keptNewestFirst.toReversed();
  const reactions = await listMessageReactionSummaries(
    conversationId,
    userId,
    [],
    messages.map((message) => message.id)
  );
  return {
    hasMore: rows.length > 50 || truncated,
    messages: messages.map((message) => ({
      ...message,
      reactions: reactions.get(message.id) ?? [],
    })),
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
    viewOnceMediaIds?: string[];
  },
  tx: PrismaTransaction
): Promise<void> {
  const hasNormal = Boolean(input.messageId);
  const hasIncognito = Boolean(input.incognitoMessageId);
  if (hasNormal === hasIncognito) {
    throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
  }
  let incognitoSessionId: string | null = null;
  let messageCreatedAt: Date;
  let messageExpiresAt: Date | null = null;
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
    messageCreatedAt = fromPrismaDateTime(target.createdAt);
  } else {
    const target = await tx.orm.public.Messages.where({
      id: requireLifecycleValue(input.messageId),
    }).first();
    if (!target || target.conversationId !== input.conversationId) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    messageCreatedAt = fromPrismaDateTime(target.createdAt);
    messageExpiresAt = target.expiresAt
      ? fromPrismaDateTime(target.expiresAt)
      : null;
  }
  const ordinaryIds = new Set(input.mediaIds);
  const viewOnceIds = new Set(input.viewOnceMediaIds);
  if (
    viewOnceIds.size > 1 ||
    ordinaryIds.size !== input.mediaIds.length ||
    viewOnceIds.size !== (input.viewOnceMediaIds?.length ?? 0) ||
    [...viewOnceIds].some((mediaId) => ordinaryIds.has(mediaId))
  ) {
    throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
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
    if (media.messageViewOnce) {
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
  if (viewOnceIds.size > 0) {
    const { rows: recipientRows } = await rawQuery<{ userId: string }>(
      extractedSql.statement17,
      [input.conversationId, input.userId],
      { userId: "pg/text@1" },
      tx
    );
    if (recipientRows.length === 0) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    const { rows: expiryRows } = await rawQuery<{
      deliveryExpiresAt: Date;
      live: boolean;
    }>(
      extractedSql.statement18,
      [messageCreatedAt, messageExpiresAt],
      {
        deliveryExpiresAt: "pg/timestamp-temporal@1",
        live: "pg/bool@1",
      },
      tx
    );
    const expiry = requireLifecycleValue(expiryRows[0]);
    if (!expiry.live) {
      throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
    }
    for (const mediaId of viewOnceIds) {
      const media = await tx.orm.public.PostMedia.where({
        id: mediaId,
      }).first();
      const detectedMime = media?.detectedMime?.toLowerCase() ?? "";
      if (
        !media ||
        media.userId !== input.userId ||
        media.messageConversationId !== input.conversationId ||
        media.postId ||
        media.commentId ||
        media.status !== "READY" ||
        media._type !== "IMAGE" ||
        !media.messageViewOnce ||
        !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
          detectedMime
        ) ||
        (hasIncognito
          ? media.incognitoSessionId !== incognitoSessionId
          : media.incognitoSessionId !== null)
      ) {
        throw new ChatLifecycleError("INVALID_ATTACHMENT", 400);
      }
      await tx.orm.public.PostMedia.where({ id: mediaId }).update({
        messageLifecycleProtected: true,
      });
      const link = await tx.orm.public.MessageMediaLinks.select("id").create({
        deliveryExpiresAt: toPrismaDateTime(expiry.deliveryExpiresAt),
        incognitoMessageId: input.incognitoMessageId ?? null,
        mediaId,
        messageId: input.messageId ?? null,
        viewOnce: true,
      });
      await tx.orm.public.MessageViewOnceRecipients.createAll(
        recipientRows.map((recipient) => ({
          mediaLinkId: link.id,
          userId: recipient.userId,
        }))
      );
    }
  }
}

interface ViewOnceGrantRow {
  messageId: string;
  sessionId: string | null;
  recipientId: string;
  objectKey: string | null;
  mimeType: string;
  size: number;
  live: boolean;
  deliveryExpiresAt: Date | null;
}

const viewOnceGrantRowSpec = {
  deliveryExpiresAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
  live: "pg/bool@1",
  messageId: "pg/text@1",
  mimeType: "pg/text@1",
  objectKey: { codecId: "pg/text@1", nullable: true },
  recipientId: "pg/text@1",
  sessionId: { codecId: "pg/text@1", nullable: true },
  size: "pg/int4@1",
} as const;

export async function reserveViewOnceMedia(
  conversationId: string,
  mediaId: string,
  userId: string,
  grantId: string
): Promise<{ mimeType: string; objectKey: string; size: number }> {
  try {
    return await prisma.transaction(async (tx) => {
      const access = await lockChatLifecycle(conversationId, userId, tx);
      if (access.leftAt) {
        throw new ChatLifecycleError("VIEW_ONCE_UNAVAILABLE", 404);
      }
      const { rows } = await rawQuery<ViewOnceGrantRow>(
        extractedSql.statement19,
        [conversationId, mediaId, userId],
        viewOnceGrantRowSpec,
        tx
      );
      const [target] = rows;
      if (
        !target ||
        !target.live ||
        !target.objectKey ||
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
        throw new ChatLifecycleError("VIEW_ONCE_UNAVAILABLE", 410);
      }
      const existingGrant = await rawQuery<{
        status: string;
        available: boolean;
      }>(
        extractedSql.statement20,
        [grantId, target.recipientId],
        { available: "pg/bool@1", status: "pg/text@1" },
        tx
      );
      if (existingGrant.rows[0]) {
        if (existingGrant.rows[0].available) {
          return {
            mimeType: target.mimeType,
            objectKey: target.objectKey,
            size: target.size,
          };
        }
        if (existingGrant.rows[0].status !== "RESERVED") {
          throw new ChatLifecycleError("VIEW_ONCE_CONSUMED", 410);
        }
      }
      await rawExecute(extractedSql.statement21, [target.recipientId], tx);
      const history = await rawQuery<{ consumed: boolean; opening: boolean }>(
        extractedSql.statement22,
        [target.recipientId],
        { consumed: "pg/bool@1", opening: "pg/bool@1" },
        tx
      );
      if (history.rows[0]?.consumed) {
        throw new ChatLifecycleError("VIEW_ONCE_CONSUMED", 410);
      }
      if (history.rows[0]?.opening) {
        throw new ChatLifecycleError("VIEW_ONCE_OPENING", 409);
      }
      await rawExecute(
        extractedSql.statement23,
        [grantId, target.recipientId],
        tx
      );
      return {
        mimeType: target.mimeType,
        objectKey: target.objectKey,
        size: target.size,
      };
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "23505" || error.code === "P2002")
    ) {
      throw new ChatLifecycleError("VIEW_ONCE_OPENING", 409);
    }
    throw error;
  }
}

export function activateViewOnceGrant(
  conversationId: string,
  grantId: string,
  userId: string
): Promise<boolean> {
  return prisma.transaction(async (tx) => {
    const access = await lockChatLifecycle(conversationId, userId, tx);
    if (access.leftAt) {
      return false;
    }
    const { rows: sources } = await rawQuery<{
      messageId: string;
      sessionId: string | null;
    }>(
      extractedSql.statement24,
      [grantId, userId],
      {
        messageId: "pg/text@1",
        sessionId: { codecId: "pg/text@1", nullable: true },
      },
      tx
    );
    const [source] = sources;
    if (
      !source ||
      !(await messageInteractionAllowed(
        {
          conversationId,
          messageId: source.messageId,
          sessionId: source.sessionId ?? undefined,
          userId,
        },
        tx
      ))
    ) {
      return false;
    }
    const result = await rawExecute(
      extractedSql.statement25,
      [grantId, userId, conversationId],
      tx
    );
    if (result.affectedRows === 1) {
      // Keep a receipt independently of the private bytes and their short-lived grant.
      await rawExecute(extractedSql.statement26, [grantId], tx);
    }
    return result.affectedRows === 1;
  });
}

export async function releaseViewOnceGrant(
  grantId: string,
  userId: string
): Promise<void> {
  await rawExecute(extractedSql.statement27, [grantId, userId]);
}

export async function closeViewOnceGrant(
  grantId: string,
  userId: string
): Promise<void> {
  await releaseViewOnceGrant(grantId, userId);
  await rawExecute(extractedSql.statement28, [grantId, userId]);
}

export async function lifecycleMediaAllowed(
  mediaId: string,
  viewerId: string,
  options: { allowProcessing?: boolean } = {}
): Promise<boolean | null> {
  const media = await prisma.orm.public.PostMedia.select(
    "messageViewOnce",
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
  if (
    media.messageViewOnce &&
    (!options.allowProcessing || media.userId !== viewerId)
  ) {
    return false;
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
      media.status !== "DELETED"
    )
  ) {
    return false;
  }
  const { rows: linkRows } = await rawQuery<{ count: number }>(
    extractedSql.statement29,
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
        extractedSql.statement30,
        [media.incognitoSessionId, viewerId],
        { allowed: "pg/bool@1" }
      );
      return rows[0]?.allowed ?? false;
    }
    if (media.messageConversationId === null) {
      return false;
    }
    const { rows } = await rawQuery<{ allowed: boolean }>(
      extractedSql.statement31,
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
    renderExtractedSql(extractedSql.statement32, {
      fragment1: readableMessageKeyEpochsSql("$2").replace(
        'epoch_key."conversationId" = $1',
        'epoch_key."conversationId" = $5'
      ),
      fragment2: readableMessageKeyEpochsSql("$2").replace(
        'epoch_key."conversationId" = $1',
        'epoch_key."conversationId" = $5'
      ),
    }),
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

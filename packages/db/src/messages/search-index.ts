import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";

import { keys } from "../../keys";

const MAX_SEARCH_TERM_INSERT_BATCH = 100;
export const MESSAGE_SEARCH_BACKFILL_BATCH_MESSAGES = 100;
export const MESSAGE_SEARCH_BACKFILL_BATCH_BYTES = 1024 * 1024;

let searchPool: Pool | undefined;

function getSearchPool(): Pool {
  if (!searchPool) {
    searchPool = new Pool({
      application_name: "asocialmedia-dm-search",
      connectionString: keys.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      max: 4,
    });
  }
  return searchPool;
}

export interface SearchTermArtifact {
  gramKeys: string[];
  normalized: string;
}

export interface SearchDocumentArtifact {
  conversationId: string;
  keyEpoch: number;
  messageId: string;
  outboxId: string;
  revision: number;
  terms: readonly SearchTermArtifact[];
}

export interface SearchMessageWindow {
  after: Date | null;
  before: Date | null;
}

export interface SearchCandidateQuery {
  before?: { createdAt: Date; messageId: string };
  conversationId: string;
  fragments: readonly { grams: readonly string[]; text: string }[];
  limit: number;
  membershipWindows: readonly SearchMessageWindow[];
  snapshotSequence: number;
  userId: string;
}

export interface MessageSearchCountRequestInput {
  conversationId: string;
  expiresAt: Date;
  fragments: readonly { grams: readonly string[]; text: string }[];
  membershipSequence: number;
  membershipWindows: readonly SearchMessageWindow[];
  normalizationVersion: number;
  queryHash: string;
  recoveryGeneration: number;
  snapshotSequence: number;
  userId: string;
}

export interface MessageSearchCountRequest {
  attempts: number;
  conversationId: string;
  expiresAt: Date;
  fragments: { grams: string[]; text: string }[];
  id: string;
  membershipSequence: number;
  membershipWindows: SearchMessageWindow[];
  normalizationVersion: number;
  queryHash: string;
  recoveryGeneration: number;
  snapshotSequence: number;
  userId: string;
}

export interface MessageSearchCountRequestStatus {
  conversationId: string;
  exactCount: number | null;
  expiresAt: Date;
  id: string;
  membershipSequence: number;
  normalizationVersion: number;
  queryHash: string;
  recoveryGeneration: number;
  snapshotSequence: number;
  state: "cancelled" | "exact" | "pending" | "running" | "unavailable";
  userId: string;
}

export interface SearchCandidateRow {
  ciphertext: string;
  createdAt: Date;
  id: string;
  iv: string;
  keyEpoch: number;
  ratchetIndex: number;
  revision: number;
  senderId: string;
}

export interface SearchArtifactCommitResult {
  status: "indexed" | "superseded" | "unreadable";
}

export type MessageSearchMutationResult =
  | {
      changeSequence: number;
      outboxId: string;
      revision: number;
      status: "updated";
    }
  | {
      status:
        | "already-deleted"
        | "edit-expired"
        | "not-found"
        | "revision-conflict";
    };

export type MessageSearchMutationInput = {
  conversationId: string;
  expectedRevision: number;
  messageId: string;
  senderId: string;
} & (
  | {
      editWindowStart: Date;
      kind: "upsert";
      ciphertext: string;
      editedAt: Date;
      iv: string;
    }
  | { kind: "delete"; deletedAt: Date }
);

export interface MessageConversationChange {
  audienceUserIds: string[];
  conversationId: string;
  createdAt: Date;
  id: string;
  kind: string;
  messageId: string | null;
  revision: number | null;
  sequence: number;
  sourceAvailable?: boolean;
  sourceRevision?: number | null;
  globallyDeleted?: boolean;
  hiddenForViewer?: boolean;
}

export type MessageHideCommitResult =
  | { status: "membership-ended" }
  | {
      changes: MessageConversationChange[];
      hidden: number;
      unreadDecrement: number;
      status: "committed";
    };

export interface MessageSearchBackfillPosition {
  createdAt: Date | null;
  messageId: string | null;
}

export interface MessageSearchBackfillMessage {
  ciphertext: string;
  createdAt: Date;
  deletedAt: Date | null;
  id: string;
  iv: string;
  keyEpoch: number | null;
  ratchetIndex: number;
  revision: number;
  senderId: string;
}

export interface MessageSearchBackfillBatch {
  throughSequence: number;
  expectedPosition: MessageSearchBackfillPosition;
  messages: MessageSearchBackfillMessage[];
}

export interface MessageSearchBackfillArtifact {
  createdAt: Date;
  keyEpoch: number;
  messageId: string;
  revision: number;
  terms: readonly SearchTermArtifact[];
}

function pgTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeCountFragments(
  value: unknown
): { grams: string[]; text: string }[] | null {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  if (!Array.isArray(parsed)) {
    return null;
  }
  const fragments: { grams: string[]; text: string }[] = [];
  for (const item of parsed) {
    if (
      !isRecord(item) ||
      typeof item.text !== "string" ||
      !Array.isArray(item.grams) ||
      !item.grams.every((gram) => typeof gram === "string")
    ) {
      return null;
    }
    fragments.push({ grams: item.grams, text: item.text });
  }
  return fragments.length > 0 ? fragments : null;
}

function decodeCountWindows(value: unknown): SearchMessageWindow[] | null {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  if (!Array.isArray(parsed)) {
    return null;
  }
  const windows: SearchMessageWindow[] = [];
  for (const item of parsed) {
    if (
      !isRecord(item) ||
      (item.after !== null && typeof item.after !== "string") ||
      (item.before !== null && typeof item.before !== "string")
    ) {
      return null;
    }
    const after = item.after === null ? null : new Date(item.after);
    const before = item.before === null ? null : new Date(item.before);
    if (
      (after && !Number.isFinite(after.getTime())) ||
      (before && !Number.isFinite(before.getTime()))
    ) {
      return null;
    }
    windows.push({ after, before });
  }
  return windows;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function messageSearchCountRequestKey(
  input: MessageSearchCountRequestInput
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.userId,
        input.conversationId,
        input.queryHash,
        input.normalizationVersion,
        input.snapshotSequence,
        input.membershipSequence,
        input.recoveryGeneration,
      ])
    )
    .digest("hex");
}

export async function requestMessageSearchCount(
  input: MessageSearchCountRequestInput
): Promise<MessageSearchCountRequestStatus> {
  const client = await getSearchPool().connect();
  const requestKey = messageSearchCountRequestKey(input);
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`${input.userId}:${input.conversationId}`]
    );
    const existingResult = await client.query<{
      conversationId: string;
      exactCount: number | null;
      expiresAt: Date;
      id: string;
      membershipSequence: number;
      normalizationVersion: number;
      queryHash: string;
      recoveryGeneration: number;
      snapshotSequence: number;
      state: MessageSearchCountRequestStatus["state"];
      userId: string;
    }>(
      `SELECT id, state, "exactCount", "expiresAt", "userId", "conversationId",
              "queryHash", "normalizationVersion", "snapshotSequence",
              "membershipSequence", "recoveryGeneration"
         FROM public.message_search_count_requests
        WHERE "requestKey" = $1
        FOR UPDATE`,
      [requestKey]
    );
    const [existing] = existingResult.rows;
    if (
      existing &&
      existing.expiresAt.getTime() > Date.now() &&
      ["pending", "running", "exact"].includes(existing.state)
    ) {
      await client.query(
        `UPDATE public.message_search_count_requests
            SET state = 'cancelled', fragments = NULL, "membershipWindows" = NULL,
                "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
          WHERE "userId" = $1 AND "conversationId" = $2
            AND id <> $3 AND state IN ('pending', 'running')`,
        [input.userId, input.conversationId, existing.id]
      );
      await client.query("COMMIT");
      return existing;
    }
    if (existing) {
      await client.query(
        `DELETE FROM public.message_search_count_requests WHERE id = $1`,
        [existing.id]
      );
    }
    await client.query(
      `UPDATE public.message_search_count_requests
          SET state = 'cancelled', fragments = NULL, "membershipWindows" = NULL,
              "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
        WHERE "userId" = $1 AND "conversationId" = $2
          AND state IN ('pending', 'running')`,
      [input.userId, input.conversationId]
    );
    const inserted = await client.query<{
      conversationId: string;
      exactCount: number | null;
      expiresAt: Date;
      id: string;
      membershipSequence: number;
      normalizationVersion: number;
      queryHash: string;
      recoveryGeneration: number;
      snapshotSequence: number;
      state: MessageSearchCountRequestStatus["state"];
      userId: string;
    }>(
      `INSERT INTO public.message_search_count_requests
         (id, "requestKey", "userId", "conversationId", "queryHash",
          "normalizationVersion", "snapshotSequence", "membershipSequence",
          "recoveryGeneration", fragments, "membershipWindows", state,
          "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
               'pending', $12, now(), now())
       RETURNING id, state, "exactCount", "expiresAt", "userId", "conversationId",
                 "queryHash", "normalizationVersion", "snapshotSequence",
                 "membershipSequence", "recoveryGeneration"`,
      [
        randomUUID(),
        requestKey,
        input.userId,
        input.conversationId,
        input.queryHash,
        input.normalizationVersion,
        input.snapshotSequence,
        input.membershipSequence,
        input.recoveryGeneration,
        JSON.stringify(input.fragments),
        JSON.stringify(
          input.membershipWindows.map((window) => ({
            after: window.after?.toISOString() ?? null,
            before: window.before?.toISOString() ?? null,
          }))
        ),
        input.expiresAt,
      ]
    );
    const [created] = inserted.rows;
    if (!created) {
      throw new Error("Search count request insert returned no row");
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function getMessageSearchCountRequestStatus(input: {
  id: string;
  userId: string;
  conversationId: string;
}): Promise<MessageSearchCountRequestStatus | null> {
  const result = await getSearchPool().query<MessageSearchCountRequestStatus>(
    `SELECT id, state, "exactCount", "expiresAt", "userId", "conversationId",
            "queryHash", "normalizationVersion", "snapshotSequence",
            "membershipSequence", "recoveryGeneration"
       FROM public.message_search_count_requests
      WHERE id = $1 AND "userId" = $2 AND "conversationId" = $3
      LIMIT 1`,
    [input.id, input.userId, input.conversationId]
  );
  return result.rows[0] ?? null;
}

export async function listRunnableMessageSearchCounts(
  limit: number
): Promise<string[]> {
  const result = await getSearchPool().query<{ id: string }>(
    `SELECT request.id
       FROM public.message_search_count_requests AS request
       JOIN public.message_search_coverage AS coverage
         ON coverage."conversationId" = request."conversationId"
       JOIN public.message_conversations AS conversation
         ON conversation.id = request."conversationId"
       LEFT JOIN public.message_search_account_state AS account
         ON account."userId" = request."userId"
      WHERE request."expiresAt" > now()
        AND (request.state = 'pending'
          OR (request.state = 'running' AND request."leaseUntil" <= now()))
        AND coverage."backfillCompletedAt" IS NOT NULL
        AND coverage."completedChangeSeq" >= request."snapshotSequence"
        AND coverage."unrecoverableEpochs" = 0
        AND conversation."changeSeq" = request."snapshotSequence"
        AND conversation."membershipSeq" = request."membershipSequence"
        AND COALESCE(account."recoveryGeneration", 0) = request."recoveryGeneration"
      ORDER BY request."createdAt" ASC
      LIMIT $1`,
    [Math.min(Math.max(Math.trunc(limit), 1), 100)]
  );
  return result.rows.map((row) => row.id);
}

export async function expireStaleMessageSearchCounts(): Promise<void> {
  await getSearchPool().query(
    `UPDATE public.message_search_count_requests AS request
        SET state = 'unavailable', fragments = NULL, "membershipWindows" = NULL,
            "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
      WHERE request.state IN ('pending', 'running')
        AND (request."expiresAt" <= now()
          OR NOT EXISTS (
            SELECT 1
              FROM public.message_search_coverage AS coverage
             WHERE coverage."conversationId" = request."conversationId"
               AND coverage."backfillCompletedAt" IS NOT NULL
               AND coverage."completedChangeSeq" >= request."snapshotSequence"
               AND coverage."unrecoverableEpochs" = 0
          )
          OR EXISTS (
            SELECT 1
              FROM public.message_conversations AS conversation
             WHERE conversation.id = request."conversationId"
               AND (conversation."changeSeq" <> request."snapshotSequence"
                 OR conversation."membershipSeq" <> request."membershipSequence")
          )
          OR COALESCE((
            SELECT account."recoveryGeneration"
              FROM public.message_search_account_state AS account
             WHERE account."userId" = request."userId"
          ), 0) <> request."recoveryGeneration")`
  );
}

export async function claimMessageSearchCountRequest(
  id: string
): Promise<MessageSearchCountRequest | null> {
  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{
      attempts: number;
      conversationId: string;
      expiresAt: Date;
      fragments: unknown;
      id: string;
      membershipSequence: number;
      membershipWindows: unknown;
      normalizationVersion: number;
      queryHash: string;
      recoveryGeneration: number;
      snapshotSequence: number;
      userId: string;
    }>(
      `SELECT request.id, request."userId", request."conversationId",
              request."queryHash", request."normalizationVersion",
              request."snapshotSequence", request."membershipSequence",
              request."recoveryGeneration", request.fragments,
              request."membershipWindows", request.attempts, request."expiresAt"
         FROM public.message_search_count_requests AS request
         JOIN public.message_search_coverage AS coverage
           ON coverage."conversationId" = request."conversationId"
         JOIN public.message_conversations AS conversation
           ON conversation.id = request."conversationId"
         LEFT JOIN public.message_search_account_state AS account
           ON account."userId" = request."userId"
        WHERE request.id = $1
          AND request."expiresAt" > now()
          AND (request.state = 'pending'
            OR (request.state = 'running' AND request."leaseUntil" <= now()))
          AND coverage."backfillCompletedAt" IS NOT NULL
          AND coverage."completedChangeSeq" >= request."snapshotSequence"
          AND coverage."unrecoverableEpochs" = 0
          AND conversation."changeSeq" = request."snapshotSequence"
          AND conversation."membershipSeq" = request."membershipSequence"
          AND COALESCE(account."recoveryGeneration", 0) = request."recoveryGeneration"
        FOR UPDATE OF request SKIP LOCKED`,
      [id]
    );
    const [row] = selected.rows;
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const fragments = decodeCountFragments(row.fragments);
    const membershipWindows = decodeCountWindows(row.membershipWindows);
    if (!fragments || !membershipWindows) {
      await client.query(
        `UPDATE public.message_search_count_requests
            SET state = 'unavailable', fragments = NULL, "membershipWindows" = NULL,
                "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
          WHERE id = $1`,
        [id]
      );
      await client.query("COMMIT");
      return null;
    }
    if (row.attempts >= 8) {
      await client.query(
        `UPDATE public.message_search_count_requests
            SET state = 'unavailable', fragments = NULL, "membershipWindows" = NULL,
                "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
          WHERE id = $1`,
        [id]
      );
      await client.query("COMMIT");
      return null;
    }
    const lease = await client.query(
      `UPDATE public.message_search_count_requests
          SET state = 'running', attempts = attempts + 1,
              "leaseUntil" = now() + interval '2 minutes', "updatedAt" = now()
        WHERE id = $1`,
      [id]
    );
    if (lease.rowCount !== 1) {
      throw new Error("Search count request lease was not acquired");
    }
    await client.query("COMMIT");
    return {
      attempts: row.attempts + 1,
      conversationId: row.conversationId,
      expiresAt: row.expiresAt,
      fragments,
      id: row.id,
      membershipSequence: row.membershipSequence,
      membershipWindows,
      normalizationVersion: row.normalizationVersion,
      queryHash: row.queryHash,
      recoveryGeneration: row.recoveryGeneration,
      snapshotSequence: row.snapshotSequence,
      userId: row.userId,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function completeMessageSearchCountRequest(
  id: string,
  exactCount: number
): Promise<void> {
  if (!Number.isSafeInteger(exactCount) || exactCount < 0) {
    throw new Error("Search count result is outside the supported range");
  }
  await getSearchPool().query(
    `UPDATE public.message_search_count_requests
        SET state = 'exact', "exactCount" = $2, fragments = NULL,
            "membershipWindows" = NULL, "leaseUntil" = NULL,
            "completedAt" = now(), "updatedAt" = now()
      WHERE id = $1 AND state = 'running' AND "expiresAt" > now()`,
    [id, exactCount]
  );
}

export async function releaseMessageSearchCountRequest(
  id: string
): Promise<void> {
  await getSearchPool().query(
    `UPDATE public.message_search_count_requests
        SET state = CASE WHEN attempts >= 8 THEN 'unavailable' ELSE 'pending' END,
            fragments = CASE WHEN attempts >= 8 THEN NULL ELSE fragments END,
            "membershipWindows" = CASE WHEN attempts >= 8 THEN NULL ELSE "membershipWindows" END,
            "leaseUntil" = NULL,
            "completedAt" = CASE WHEN attempts >= 8 THEN now() ELSE NULL END,
            "updatedAt" = now()
      WHERE id = $1 AND state = 'running'`,
    [id]
  );
}

export async function commitMessageSearchMutation(
  input: MessageSearchMutationInput
): Promise<MessageSearchMutationResult> {
  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN");
    const source = await client.query<{
      deletedAt: Date | null;
      revision: number;
      withinEditWindow: boolean;
    }>(
      `SELECT "deletedAt", revision,
              COALESCE("createdAt" >= $4::timestamp, false) AS "withinEditWindow"
         FROM public.messages AS message
        WHERE id = $1
          AND "conversationId" = $2
          AND "senderId" = $3
          AND EXISTS (
            SELECT 1
              FROM public.message_conversation_members AS member
             WHERE member."conversationId" = message."conversationId"
               AND member."userId" = $3
               AND member."leftAt" IS NULL
          )
        FOR UPDATE OF message`,
      [
        input.messageId,
        input.conversationId,
        input.senderId,
        input.kind === "upsert" ? input.editWindowStart : null,
      ]
    );
    const [message] = source.rows;
    if (!message) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    if (message.revision !== input.expectedRevision) {
      await client.query("COMMIT");
      return { status: "revision-conflict" };
    }
    if (message.deletedAt) {
      await client.query("COMMIT");
      return { status: "already-deleted" };
    }
    if (input.kind === "upsert" && !message.withinEditWindow) {
      await client.query("COMMIT");
      return { status: "edit-expired" };
    }

    const update =
      input.kind === "delete"
        ? await client.query<{ revision: number }>(
            `UPDATE public.messages
                SET "deletedAt" = $4, revision = revision + 1
              WHERE id = $1 AND "conversationId" = $2 AND revision = $3
              RETURNING revision`,
            [
              input.messageId,
              input.conversationId,
              input.expectedRevision,
              input.deletedAt,
            ]
          )
        : await client.query<{ revision: number }>(
            `UPDATE public.messages
                SET ciphertext = $4, iv = $5, "editedAt" = $6,
                    revision = revision + 1
              WHERE id = $1 AND "conversationId" = $2 AND revision = $3
              RETURNING revision`,
            [
              input.messageId,
              input.conversationId,
              input.expectedRevision,
              input.ciphertext,
              input.iv,
              input.editedAt,
            ]
          );
    const [updatedMessage] = update.rows;
    if (!updatedMessage) {
      throw new Error("Message revision changed while holding its row lock");
    }

    const sequenceResult = await client.query<{ changeSeq: number }>(
      `UPDATE public.message_conversations
          SET "changeSeq" = "changeSeq" + 1
        WHERE id = $1
        RETURNING "changeSeq"`,
      [input.conversationId]
    );
    const sequence = sequenceResult.rows[0]?.changeSeq;
    if (sequence === undefined) {
      throw new Error("Message conversation disappeared during mutation");
    }
    const audienceResult = await client.query<{ audienceUserIds: string[] }>(
      `SELECT COALESCE(array_agg("userId"), ARRAY[]::text[]) AS "audienceUserIds"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [input.conversationId]
    );
    const audienceUserIds = audienceResult.rows[0]?.audienceUserIds ?? [];
    const outboxId = randomUUID();
    await client.query(
      `INSERT INTO public.message_search_outbox
         (id, "conversationId", "messageId", revision, "changeSequence", kind, "audienceUserIds")
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`,
      [
        outboxId,
        input.conversationId,
        input.messageId,
        updatedMessage.revision,
        sequence,
        input.kind,
        audienceUserIds,
      ]
    );
    await client.query(
      `INSERT INTO public.message_conversation_changes
         (id, "conversationId", sequence, "messageId", revision, kind, "audienceUserIds")
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`,
      [
        randomUUID(),
        input.conversationId,
        sequence,
        input.messageId,
        updatedMessage.revision,
        input.kind === "delete" ? "message.deleted" : "message.edited",
        audienceUserIds,
      ]
    );
    await client.query("COMMIT");
    return {
      changeSequence: sequence,
      outboxId,
      revision: updatedMessage.revision,
      status: "updated",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function commitMessageHides(input: {
  conversationId: string;
  messageIds: readonly string[];
  userId: string;
}): Promise<MessageHideCommitResult> {
  const messageIds = [...new Set(input.messageIds)].toSorted();
  if (messageIds.length === 0) {
    return {
      changes: [],
      hidden: 0,
      status: "committed",
      unreadDecrement: 0,
    };
  }

  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN");
    const conversation = await client.query<{ changeSeq: number }>(
      `SELECT "changeSeq"
         FROM public.message_conversations
        WHERE id = $1
        FOR UPDATE`,
      [input.conversationId]
    );
    if (conversation.rows.length === 0) {
      await client.query("COMMIT");
      return {
        changes: [],
        hidden: 0,
        status: "committed",
        unreadDecrement: 0,
      };
    }
    const membership = await client.query<{
      lastReadAt: Date | null;
      leftAt: Date | null;
    }>(
      `SELECT "lastReadAt", "leftAt"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "userId" = $2
        FOR UPDATE`,
      [input.conversationId, input.userId]
    );
    const [member] = membership.rows;
    if (!member || member.leftAt) {
      await client.query("COMMIT");
      return { status: "membership-ended" };
    }

    const source = await client.query<{
      createdAt: Date;
      deletedAt: Date | null;
      id: string;
      revision: number;
      senderId: string;
    }>(
      `SELECT id, "senderId", "createdAt", "deletedAt", revision
         FROM public.messages
        WHERE "conversationId" = $1 AND id = ANY($2::text[])
        ORDER BY id`,
      [input.conversationId, messageIds]
    );
    if (source.rows.length === 0) {
      await client.query("COMMIT");
      return {
        changes: [],
        hidden: 0,
        status: "committed",
        unreadDecrement: 0,
      };
    }

    const inserted = await client.query<{ messageId: string }>(
      `INSERT INTO public.message_hidden ("messageId", "userId")
       SELECT message.id, $2
         FROM public.messages AS message
        WHERE message."conversationId" = $1
          AND message.id = ANY($3::text[])
       ON CONFLICT ("messageId", "userId") DO NOTHING
       RETURNING "messageId"`,
      [input.conversationId, input.userId, source.rows.map((row) => row.id)]
    );
    const insertedIds = inserted.rows.map((row) => row.messageId).toSorted();
    if (insertedIds.length === 0) {
      await client.query("COMMIT");
      return {
        changes: [],
        hidden: 0,
        status: "committed",
        unreadDecrement: 0,
      };
    }

    const bumped = await client.query<{ changeSeq: number }>(
      `UPDATE public.message_conversations
          SET "changeSeq" = "changeSeq" + $2
        WHERE id = $1
        RETURNING "changeSeq"`,
      [input.conversationId, insertedIds.length]
    );
    const finalSequence = bumped.rows[0]?.changeSeq;
    if (finalSequence === undefined) {
      throw new Error("Message conversation disappeared while hiding messages");
    }

    const firstSequence = finalSequence - insertedIds.length + 1;
    const createdAt = new Date();
    const sourceById = new Map(source.rows.map((row) => [row.id, row]));
    const changes = insertedIds.map((messageId, index) => {
      const message = sourceById.get(messageId);
      if (!message) {
        throw new Error("Hidden message disappeared while writing its change");
      }
      return {
        audienceUserIds: [input.userId],
        conversationId: input.conversationId,
        createdAt,
        id: randomUUID(),
        kind: "message.hidden",
        messageId,
        revision: message.revision,
        sequence: firstSequence + index,
      } satisfies MessageConversationChange;
    });
    const values: unknown[] = [];
    const placeholders = changes.map((change, index) => {
      const offset = index * 7;
      values.push(
        change.id,
        change.conversationId,
        change.sequence,
        change.messageId,
        change.revision,
        change.kind,
        change.audienceUserIds
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::text[])`;
    });
    await client.query(
      `INSERT INTO public.message_conversation_changes
         (id, "conversationId", sequence, "messageId", revision, kind, "audienceUserIds")
       VALUES ${placeholders.join(", ")}`,
      values
    );

    const readAt = member.lastReadAt?.getTime() ?? 0;
    const unreadDecrement = source.rows.filter(
      (row) =>
        insertedIds.includes(row.id) &&
        row.senderId !== input.userId &&
        row.deletedAt === null &&
        row.createdAt.getTime() > readAt
    ).length;
    await client.query("COMMIT");
    return {
      changes,
      hidden: changes.length,
      status: "committed",
      unreadDecrement,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function listMessageConversationChanges(input: {
  afterSequence: number;
  conversationId: string;
  limit: number;
  membershipWindows: readonly SearchMessageWindow[];
  snapshotSequence: number;
  userId: string;
}): Promise<MessageConversationChange[]> {
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  const result = await getSearchPool().query<MessageConversationChange>(
    `SELECT change_event.id,
            change_event."conversationId",
            change_event.sequence,
            change_event."messageId",
            change_event.revision,
            change_event.kind,
            change_event."audienceUserIds",
            change_event."createdAt",
            (message.id IS NOT NULL) AS "sourceAvailable",
            message.revision AS "sourceRevision",
            COALESCE(message."deletedAt" IS NOT NULL, false) AS "globallyDeleted",
            (hidden."messageId" IS NOT NULL) AS "hiddenForViewer"
       FROM public.message_conversation_changes AS change_event
       LEFT JOIN public.messages AS message
         ON message.id = change_event."messageId"
        AND message."conversationId" = change_event."conversationId"
       LEFT JOIN public.message_hidden AS hidden
         ON hidden."messageId" = change_event."messageId"
        AND hidden."userId" = $4
      WHERE change_event."conversationId" = $1
        AND change_event.sequence > $2
        AND change_event.sequence <= $3
        AND change_event."audienceUserIds" @> ARRAY[$4::text]
        AND (
          change_event."messageId" IS NULL OR message.id IS NULL OR (
            $5::jsonb IS NULL OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements($5::jsonb) AS membership_window
               WHERE (membership_window.value->>'after' IS NULL OR message."createdAt" >= (membership_window.value->>'after')::timestamp)
                 AND (membership_window.value->>'before' IS NULL OR message."createdAt" <= (membership_window.value->>'before')::timestamp)
            )
          )
        )
      ORDER BY change_event.sequence ASC
      LIMIT $6`,
    [
      input.conversationId,
      input.afterSequence,
      input.snapshotSequence,
      input.userId,
      JSON.stringify(windows),
      Math.min(Math.max(Math.trunc(input.limit), 1), 101),
    ]
  );
  return result.rows;
}

export async function persistSearchDocument(
  artifact: SearchDocumentArtifact
): Promise<SearchArtifactCommitResult> {
  const pool = getSearchPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const source = await client.query<{
      createdAt: Date;
      deletedAt: Date | null;
      revision: number;
    }>(
      `SELECT "createdAt", "deletedAt", revision
         FROM public.messages
        WHERE id = $1 AND "conversationId" = $2
        FOR SHARE`,
      [artifact.messageId, artifact.conversationId]
    );
    const [row] = source.rows;
    let status: SearchArtifactCommitResult["status"] = "superseded";

    if (row && !row.deletedAt && row.revision === artifact.revision) {
      const terms = [
        ...new Map(
          artifact.terms.map((term) => [term.normalized, term])
        ).values(),
      ];
      const termInsertQueries: {
        sql: string;
        values: unknown[];
      }[] = [];
      for (
        let offset = 0;
        offset < terms.length;
        offset += MAX_SEARCH_TERM_INSERT_BATCH
      ) {
        const batch = terms.slice(
          offset,
          offset + MAX_SEARCH_TERM_INSERT_BATCH
        );
        const values: unknown[] = [];
        const tuples = batch.map((term, index) => {
          const base = index * 3;
          values.push(artifact.conversationId, term.normalized, term.gramKeys);
          return `($${base + 1}, $${base + 2}, $${base + 3}::text[])`;
        });
        termInsertQueries.push({
          sql: `INSERT INTO public.message_search_terms
             ("conversationId", normalized, "gramKeys")
           VALUES ${tuples.join(",")}
           ON CONFLICT ("conversationId", normalized) DO NOTHING`,
          values,
        });
      }
      await Promise.all(
        termInsertQueries.map(({ sql, values }) => client.query(sql, values))
      );

      const normalizedTerms = terms.map((term) => term.normalized);
      const termRows = normalizedTerms.length
        ? await client.query<{ id: number }>(
            `SELECT id
               FROM public.message_search_terms
              WHERE "conversationId" = $1 AND normalized = ANY($2::text[])`,
            [artifact.conversationId, normalizedTerms]
          )
        : { rows: [] as { id: number }[] };
      const termIds = [...new Set(termRows.rows.map((term) => term.id))];

      await client.query(
        `INSERT INTO public.message_search_documents
           ("messageId", "conversationId", revision, "createdAt", "termIds")
         VALUES ($1, $2, $3, $4, $5::int[])
         ON CONFLICT ("messageId") DO UPDATE
           SET "conversationId" = EXCLUDED."conversationId",
               revision = EXCLUDED.revision,
               "createdAt" = EXCLUDED."createdAt",
               "termIds" = EXCLUDED."termIds"
         WHERE public.message_search_documents.revision <= EXCLUDED.revision`,
        [
          artifact.messageId,
          artifact.conversationId,
          artifact.revision,
          row.createdAt,
          termIds,
        ]
      );
      await client.query(
        `UPDATE public.messages
            SET "keyEpoch" = $2
          WHERE id = $1 AND revision = $3 AND "keyEpoch" IS NULL`,
        [artifact.messageId, artifact.keyEpoch, artifact.revision]
      );
      status = "indexed";
    } else {
      await client.query(
        `DELETE FROM public.message_search_documents
          WHERE "messageId" = $1 AND revision <= $2`,
        [artifact.messageId, artifact.revision]
      );
    }

    const outbox = await client.query<{
      changeSequence: number;
      conversationId: string;
    }>(
      `UPDATE public.message_search_outbox
          SET "completedAt" = now()
        WHERE id = $1 AND revision = $2 AND "completedAt" IS NULL
        RETURNING "changeSequence", "conversationId"`,
      [artifact.outboxId, artifact.revision]
    );
    const [completed] = outbox.rows;
    if (completed) {
      const coverage = await client.query<{
        maxSequence: number | null;
        pendingSequence: number | null;
      }>(
        `SELECT MAX("changeSequence") AS "maxSequence",
                MIN("changeSequence") FILTER (WHERE "completedAt" IS NULL) AS "pendingSequence"
           FROM public.message_search_outbox
          WHERE "conversationId" = $1`,
        [completed.conversationId]
      );
      const [coverageRow] = coverage.rows;
      const settledSequence =
        coverageRow?.pendingSequence === null ||
        coverageRow?.pendingSequence === undefined
          ? (coverageRow?.maxSequence ?? 0)
          : Math.max(0, coverageRow.pendingSequence - 1);
      await client.query(
        `INSERT INTO public.message_search_coverage
           ("conversationId", "artifactsCommitted", "completedChangeSeq", "updatedAt")
         VALUES ($1, $2, $3, now())
         ON CONFLICT ("conversationId") DO UPDATE
           SET "artifactsCommitted" = public.message_search_coverage."artifactsCommitted" + $2,
               "completedChangeSeq" = GREATEST(public.message_search_coverage."completedChangeSeq", $3),
               "updatedAt" = now()`,
        [
          completed.conversationId,
          status === "indexed" ? 1 : 0,
          settledSequence,
        ]
      );
    }

    await client.query("COMMIT");
    return { status };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function startMessageSearchBackfill(
  conversationId: string
): Promise<{
  completedAt: Date | null;
  expectedPosition: MessageSearchBackfillPosition;
  throughSequence: number | null;
} | null> {
  const pool = getSearchPool();
  await pool.query(
    `INSERT INTO public.message_search_coverage
       ("conversationId", "backfillThroughSequence", "backfillStartedAt", "updatedAt")
     SELECT id, "changeSeq", now(), now()
       FROM public.message_conversations
      WHERE id = $1
     ON CONFLICT ("conversationId") DO UPDATE
       SET "backfillThroughSequence" = EXCLUDED."backfillThroughSequence",
           "backfillStartedAt" = now(),
           "updatedAt" = now()
     WHERE public.message_search_coverage."backfillStartedAt" IS NULL
       AND public.message_search_coverage."backfillCompletedAt" IS NULL`,
    [conversationId]
  );
  const result = await pool.query<{
    backfillCompletedAt: Date | null;
    backfillCursorCreatedAt: Date | null;
    backfillCursorMessageId: string | null;
    backfillThroughSequence: number | null;
  }>(
    `SELECT "backfillCompletedAt", "backfillCursorCreatedAt",
            "backfillCursorMessageId", "backfillThroughSequence"
       FROM public.message_search_coverage
      WHERE "conversationId" = $1`,
    [conversationId]
  );
  const [row] = result.rows;
  if (!row) {
    return null;
  }
  return {
    completedAt: row.backfillCompletedAt,
    expectedPosition: {
      createdAt: row.backfillCursorCreatedAt,
      messageId: row.backfillCursorMessageId,
    },
    throughSequence: row.backfillThroughSequence,
  };
}

export async function listRunnableMessageSearchBackfills(
  limit = 20
): Promise<{ conversationId: string; cursorMessageId: string | null }[]> {
  const result = await getSearchPool().query<{
    conversationId: string;
    backfillCursorMessageId: string | null;
  }>(
    `SELECT "conversationId", "backfillCursorMessageId"
       FROM public.message_search_coverage
      WHERE "backfillStartedAt" IS NOT NULL
        AND "backfillCompletedAt" IS NULL
        AND "backfillThroughSequence" IS NOT NULL
      ORDER BY "updatedAt" ASC
      LIMIT $1`,
    [Math.min(Math.max(Math.trunc(limit), 1), 100)]
  );
  return result.rows.map((row) => ({
    conversationId: row.conversationId,
    cursorMessageId: row.backfillCursorMessageId,
  }));
}

export async function readNextMessageSearchBackfillBatch(
  conversationId: string
): Promise<MessageSearchBackfillBatch | null> {
  const pool = getSearchPool();
  const coverageResult = await pool.query<{
    backfillCompletedAt: Date | null;
    backfillCursorCreatedAt: Date | null;
    backfillCursorMessageId: string | null;
    backfillThroughSequence: number | null;
  }>(
    `SELECT "backfillCompletedAt", "backfillCursorCreatedAt",
            "backfillCursorMessageId", "backfillThroughSequence"
       FROM public.message_search_coverage
      WHERE "conversationId" = $1
        AND "backfillStartedAt" IS NOT NULL`,
    [conversationId]
  );
  const [coverage] = coverageResult.rows;
  if (
    !coverage ||
    coverage.backfillCompletedAt ||
    coverage.backfillThroughSequence === null
  ) {
    return null;
  }

  const messagesResult = await pool.query<MessageSearchBackfillMessage>(
    `WITH candidates AS (
       SELECT id, "ciphertext", "createdAt", "deletedAt", "iv",
              "keyEpoch", "ratchetIndex", revision, "senderId",
              octet_length("ciphertext") AS "ciphertextBytes"
         FROM public.messages
        WHERE "conversationId" = $1
          AND "creationSequence" <= $2
          AND ($3::timestamp IS NULL OR ("createdAt", id) > ($3::timestamp, $4::text))
        ORDER BY "createdAt" ASC, id ASC
        LIMIT $5
     ), sized AS (
       SELECT *, SUM("ciphertextBytes") OVER (
         ORDER BY "createdAt" ASC, id ASC
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS "batchBytes"
         FROM candidates
     )
     SELECT id, "ciphertext", "createdAt", "deletedAt", "iv", "keyEpoch",
            "ratchetIndex", revision, "senderId"
       FROM sized
      WHERE "batchBytes" <= $6
      ORDER BY "createdAt" ASC, id ASC`,
    [
      conversationId,
      coverage.backfillThroughSequence,
      coverage.backfillCursorCreatedAt,
      coverage.backfillCursorMessageId,
      MESSAGE_SEARCH_BACKFILL_BATCH_MESSAGES,
      MESSAGE_SEARCH_BACKFILL_BATCH_BYTES,
    ]
  );
  return {
    expectedPosition: {
      createdAt: coverage.backfillCursorCreatedAt,
      messageId: coverage.backfillCursorMessageId,
    },
    messages: messagesResult.rows,
    throughSequence: coverage.backfillThroughSequence,
  };
}

export async function commitMessageSearchBackfillBatch(input: {
  artifacts: readonly MessageSearchBackfillArtifact[];
  conversationId: string;
  expectedPosition: MessageSearchBackfillPosition;
  finished: boolean;
  nextPosition: MessageSearchBackfillPosition;
  rowsTraversed: number;
  throughSequence: number;
  unrecoverableEpochs: number;
}): Promise<{ committed: boolean }> {
  const pool = getSearchPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `UPDATE public.message_search_coverage
          SET "backfillCursorCreatedAt" = $3,
              "backfillCursorMessageId" = $4,
              "backfillCompletedAt" = CASE WHEN $5 THEN now() ELSE NULL END,
              "updatedAt" = now()
        WHERE "conversationId" = $1
          AND "backfillThroughSequence" = $2
          AND "backfillCompletedAt" IS NULL
          AND "backfillCursorCreatedAt" IS NOT DISTINCT FROM $6::timestamp
          AND "backfillCursorMessageId" IS NOT DISTINCT FROM $7::text
        RETURNING "conversationId"`,
      [
        input.conversationId,
        input.throughSequence,
        input.nextPosition.createdAt,
        input.nextPosition.messageId,
        input.finished,
        input.expectedPosition.createdAt,
        input.expectedPosition.messageId,
      ]
    );
    if (claimed.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { committed: false };
    }

    const messageIds = input.artifacts.map((artifact) => artifact.messageId);
    const sourceRows = messageIds.length
      ? await client.query<{
          deletedAt: Date | null;
          id: string;
          revision: number;
        }>(
          `SELECT id, revision, "deletedAt"
             FROM public.messages
            WHERE "conversationId" = $1 AND id = ANY($2::text[])
            FOR SHARE`,
          [input.conversationId, messageIds]
        )
      : {
          rows: [] as {
            deletedAt: Date | null;
            id: string;
            revision: number;
          }[],
        };
    const currentRevisions = new Map(
      sourceRows.rows.map((row) => [row.id, row])
    );
    const currentArtifacts = input.artifacts.filter((artifact) => {
      const current = currentRevisions.get(artifact.messageId);
      return (
        current && !current.deletedAt && current.revision === artifact.revision
      );
    });
    const terms = [
      ...new Map(
        currentArtifacts
          .flatMap((artifact) => artifact.terms)
          .map((term) => [term.normalized, term])
      ).values(),
    ];
    const termInsertQueries: { sql: string; values: unknown[] }[] = [];
    for (
      let offset = 0;
      offset < terms.length;
      offset += MAX_SEARCH_TERM_INSERT_BATCH
    ) {
      const batch = terms.slice(offset, offset + MAX_SEARCH_TERM_INSERT_BATCH);
      const values: unknown[] = [];
      const tuples = batch.map((term, index) => {
        const base = index * 3;
        values.push(input.conversationId, term.normalized, term.gramKeys);
        return `($${base + 1}, $${base + 2}, $${base + 3}::text[])`;
      });
      termInsertQueries.push({
        sql: `INSERT INTO public.message_search_terms
           ("conversationId", normalized, "gramKeys")
         VALUES ${tuples.join(",")}
         ON CONFLICT ("conversationId", normalized) DO NOTHING`,
        values,
      });
    }
    await Promise.all(
      termInsertQueries.map(({ sql, values }) => client.query(sql, values))
    );

    if (currentArtifacts.length > 0) {
      const normalizedTerms = terms.map((term) => term.normalized);
      const termRows = await client.query<{ id: number; normalized: string }>(
        `SELECT id, normalized
           FROM public.message_search_terms
          WHERE "conversationId" = $1 AND normalized = ANY($2::text[])`,
        [input.conversationId, normalizedTerms]
      );
      const termIdsByText = new Map(
        termRows.rows.map((row) => [row.normalized, row.id])
      );
      const documentValues: unknown[] = [];
      const documentTuples = currentArtifacts.map((artifact, index) => {
        const base = index * 5;
        const termIds = [
          ...new Set(
            artifact.terms.flatMap((term) => {
              const id = termIdsByText.get(term.normalized);
              return id === undefined ? [] : [id];
            })
          ),
        ];
        documentValues.push(
          artifact.messageId,
          input.conversationId,
          artifact.revision,
          artifact.createdAt,
          termIds
        );
        return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::int4, $${base + 4}::timestamp, $${base + 5}::int4[])`;
      });
      await client.query(
        `INSERT INTO public.message_search_documents
           ("messageId", "conversationId", revision, "createdAt", "termIds")
         VALUES ${documentTuples.join(",")}
         ON CONFLICT ("messageId") DO UPDATE
           SET "conversationId" = EXCLUDED."conversationId",
               revision = EXCLUDED.revision,
               "createdAt" = EXCLUDED."createdAt",
               "termIds" = EXCLUDED."termIds"
         WHERE public.message_search_documents.revision <= EXCLUDED.revision`,
        documentValues
      );
      const epochValues: unknown[] = [];
      const epochTuples = currentArtifacts.map((artifact, index) => {
        const base = index * 3;
        epochValues.push(
          artifact.messageId,
          artifact.keyEpoch,
          artifact.revision
        );
        return `($${base + 1}::text, $${base + 2}::int4, $${base + 3}::int4)`;
      });
      await client.query(
        `UPDATE public.messages AS message
            SET "keyEpoch" = candidate."keyEpoch"
           FROM (VALUES ${epochTuples.join(",")}) AS candidate(id, "keyEpoch", revision)
          WHERE message.id = candidate.id
            AND message."conversationId" = $${epochValues.length + 1}
            AND message.revision = candidate.revision
            AND message."keyEpoch" IS NULL`,
        [...epochValues, input.conversationId]
      );
    }

    await client.query(
      `UPDATE public.message_search_coverage
          SET "rowsTraversed" = "rowsTraversed" + $2,
              "artifactsCommitted" = "artifactsCommitted" + $3,
              "unrecoverableEpochs" = "unrecoverableEpochs" + $4,
              "completedChangeSeq" = CASE WHEN $5
                THEN GREATEST(
                  "completedChangeSeq",
                  LEAST("backfillThroughSequence", COALESCE((
                    SELECT MIN("changeSequence") - 1
                      FROM public.message_search_outbox
                     WHERE "conversationId" = $1 AND "completedAt" IS NULL
                  ), "backfillThroughSequence"))
                )
                ELSE "completedChangeSeq"
              END,
              "updatedAt" = now()
        WHERE "conversationId" = $1`,
      [
        input.conversationId,
        input.rowsTraversed,
        currentArtifacts.length,
        input.unrecoverableEpochs,
        input.finished,
      ]
    );
    await client.query("COMMIT");
    return { committed: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function markSearchOutboxUnreadable(input: {
  changeSequence: number;
  conversationId: string;
  outboxId: string;
  revision: number;
}): Promise<void> {
  const pool = getSearchPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const completed = await client.query<{ conversationId: string }>(
      `UPDATE public.message_search_outbox
          SET "completedAt" = now()
        WHERE id = $1 AND revision = $2 AND "completedAt" IS NULL
        RETURNING "conversationId"`,
      [input.outboxId, input.revision]
    );
    if (completed.rows[0]) {
      const coverage = await client.query<{
        maxSequence: number | null;
        pendingSequence: number | null;
      }>(
        `SELECT MAX("changeSequence") AS "maxSequence",
                MIN("changeSequence") FILTER (WHERE "completedAt" IS NULL) AS "pendingSequence"
           FROM public.message_search_outbox
          WHERE "conversationId" = $1`,
        [input.conversationId]
      );
      const [coverageRow] = coverage.rows;
      const settledSequence =
        coverageRow?.pendingSequence === null ||
        coverageRow?.pendingSequence === undefined
          ? (coverageRow?.maxSequence ?? 0)
          : Math.max(0, coverageRow.pendingSequence - 1);
      await client.query(
        `INSERT INTO public.message_search_coverage
           ("conversationId", "unrecoverableEpochs", "completedChangeSeq", "updatedAt")
         VALUES ($1, 1, $2, now())
         ON CONFLICT ("conversationId") DO UPDATE
           SET "unrecoverableEpochs" = public.message_search_coverage."unrecoverableEpochs" + 1,
               "completedChangeSeq" = GREATEST(public.message_search_coverage."completedChangeSeq", $2),
               "updatedAt" = now()`,
        [input.conversationId, settledSequence]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function searchMessageCandidates(
  input: SearchCandidateQuery
): Promise<SearchCandidateRow[]> {
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  const pool = getSearchPool();
  const result = await pool.query<SearchCandidateRow>(
    `SELECT m.id,
            m."ciphertext",
            m.iv,
            m."ratchetIndex",
            m."senderId",
            m."createdAt",
            m.revision,
            m."keyEpoch"
       FROM public.message_search_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE d."conversationId" = $1
        AND m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_search_outbox AS newer_revision
           WHERE newer_revision."messageId" = m.id
             AND newer_revision."changeSequence" > $4
        )
        AND EXISTS (
          SELECT 1
            FROM public.message_conversation_keys AS readable_key
           WHERE readable_key."conversationId" = d."conversationId"
             AND readable_key."ownerUserId" = $2
             AND readable_key.version = m."keyEpoch"
        )
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND NOT EXISTS (
          SELECT 1
             FROM jsonb_array_elements($3::jsonb) AS fragment
           WHERE NOT EXISTS (
             SELECT 1
               FROM public.message_search_terms AS term
              WHERE term."conversationId" = d."conversationId"
                AND d."termIds" @> ARRAY[term.id]
                AND term."gramKeys" @> ARRAY(
                  SELECT jsonb_array_elements_text(fragment.value->'grams')
                )
                AND strpos(term.normalized, fragment.value->>'text') > 0
           )
        )
        AND (
          $7::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($7::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
        AND (
          $5::timestamp IS NULL OR
          (d."createdAt", d."messageId") < ($5::timestamp, $6::text)
        )
      ORDER BY d."createdAt" DESC, d."messageId" DESC
      LIMIT $8`,
    [
      input.conversationId,
      input.userId,
      JSON.stringify(input.fragments),
      input.snapshotSequence,
      input.before ? pgTimestamp(input.before.createdAt) : null,
      input.before?.messageId ?? null,
      JSON.stringify(windows),
      Math.min(Math.max(Math.trunc(input.limit), 1), 21),
    ]
  );
  return result.rows;
}

export async function countMessageSearchCandidates(input: {
  conversationId: string;
  fragments: readonly { grams: readonly string[]; text: string }[];
  membershipWindows: readonly SearchMessageWindow[];
  snapshotSequence: number;
  userId: string;
}): Promise<number> {
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '120s'`);
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM public.message_search_documents AS d
         JOIN public.messages AS m
           ON m.id = d."messageId"
          AND m."conversationId" = d."conversationId"
          AND m.revision = d.revision
         JOIN public.message_conversation_members AS member
           ON member."conversationId" = d."conversationId"
          AND member."userId" = $2
        WHERE d."conversationId" = $1
          AND m."deletedAt" IS NULL
          AND m."keyEpoch" IS NOT NULL
          AND m."creationSequence" <= $4
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_search_outbox AS newer_revision
             WHERE newer_revision."messageId" = m.id
               AND newer_revision."changeSequence" > $4
          )
          AND EXISTS (
            SELECT 1
              FROM public.message_conversation_keys AS readable_key
             WHERE readable_key."conversationId" = d."conversationId"
               AND readable_key."ownerUserId" = $2
               AND readable_key.version = m."keyEpoch"
          )
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_hidden AS hidden
             WHERE hidden."messageId" = m.id AND hidden."userId" = $2
          )
          AND NOT EXISTS (
            SELECT 1
              FROM jsonb_array_elements($3::jsonb) AS fragment
             WHERE NOT EXISTS (
               SELECT 1
                 FROM public.message_search_terms AS term
                WHERE term."conversationId" = d."conversationId"
                  AND d."termIds" @> ARRAY[term.id]
                  AND term."gramKeys" @> ARRAY(
                    SELECT jsonb_array_elements_text(fragment.value->'grams')
                  )
                  AND strpos(term.normalized, fragment.value->>'text') > 0
             )
          )
          AND (
            $5::jsonb IS NULL OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements($5::jsonb) AS membership_window
               WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
                 AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
            )
          )`,
      [
        input.conversationId,
        input.userId,
        JSON.stringify(input.fragments),
        input.snapshotSequence,
        JSON.stringify(windows),
      ]
    );
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Search count is outside the supported integer range");
    }
    await client.query("COMMIT");
    return count;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function closeMessageSearchPool(): Promise<void> {
  const pool = searchPool;
  searchPool = undefined;
  if (pool) {
    await pool.end();
  }
}

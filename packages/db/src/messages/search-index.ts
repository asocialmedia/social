import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";

import { keys } from "../../keys";

const MAX_SEARCH_TERM_INSERT_BATCH = 100;
export const MESSAGE_SEARCH_BACKFILL_BATCH_MESSAGES = 100;
export const MESSAGE_SEARCH_BACKFILL_BATCH_BYTES = 1024 * 1024;
type SearchSqlParameter = number | string | null | number[] | string[];

let searchPool: Pool | undefined;

function getSearchPool(): Pool {
  if (!searchPool) {
    searchPool = new Pool({
      application_name: "asocialmedia-dm-search",
      connectionString: keys.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      max: 12,
    });
  }
  return searchPool;
}

export interface SearchTermArtifact {
  gramKeys: string[];
  normalized: string;
}

export interface SearchReferenceArtifact {
  kind: "link" | "media" | "post";
  mediaKind?: "gif" | "image";
  ordinal: number;
  requiredId?: string;
}

export interface SearchDocumentArtifact {
  conversationId: string;
  keyEpoch: number;
  messageId: string;
  outboxId: string;
  references: readonly SearchReferenceArtifact[];
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

export interface SearchHydrationRequest {
  id: string;
  revision: number;
}

export interface SearchHydrationQuery {
  conversationId: string;
  messages: readonly SearchHydrationRequest[];
  membershipWindows: readonly SearchMessageWindow[];
  userId: string;
}

export interface SearchReferenceCursor {
  createdAt: Date;
  messageId: string;
  ordinal: number;
}

export interface SearchReferenceQuery {
  after?: SearchReferenceCursor;
  conversationId: string;
  kind: SearchReferenceArtifact["kind"];
  limit: number;
  membershipWindows: readonly SearchMessageWindow[];
  snapshotSequence: number;
  userId: string;
}

export interface SearchReferenceRow extends SearchReferenceCursor {
  createdAt: Date;
  keyEpoch: number;
  mediaKind: "gif" | "image" | null;
  requiredId: string | null;
  ratchetIndex: number;
  revision: number;
  senderId: string;
}

export interface MessageUnreadCounterMember {
  conversationId: string;
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
  createdAt: Date;
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

interface OrderedSearchDocumentRow {
  createdAt: Date | null;
  messageId: string | null;
  scannedCount: number;
  scannedThroughCreatedAt: Date | null;
  scannedThroughMessageId: string | null;
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

export type MessageReadCommitResult =
  | { status: "conversation-not-found" }
  | { status: "membership-not-found" }
  | { status: "membership-ended" }
  | { readAt: Date; readSequence: number; unreadCount: number; status: "read" };

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
  references: readonly SearchReferenceArtifact[];
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
  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query(
      `UPDATE public.message_search_count_requests AS request
          SET state = 'unavailable', "exactCount" = NULL, fragments = NULL,
              "membershipWindows" = NULL, "leaseUntil" = NULL,
              "completedAt" = now(), "updatedAt" = now()
        WHERE request.id = $1 AND request."userId" = $2
          AND request."conversationId" = $3
          AND request.state IN ('pending', 'running', 'exact')
          AND (
            request."expiresAt" <= now()
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_conversations AS conversation
               WHERE conversation.id = request."conversationId"
                 AND conversation."changeSeq" = request."snapshotSequence"
                 AND conversation."membershipSeq" = request."membershipSequence"
            )
            OR COALESCE((
              SELECT account."recoveryGeneration"
                FROM public.message_search_account_state AS account
               WHERE account."userId" = request."userId"
            ), 0) <> request."recoveryGeneration"
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_coverage AS coverage
               WHERE coverage."conversationId" = request."conversationId"
                 AND coverage."backfillCompletedAt" IS NOT NULL
                 AND coverage."completedChangeSeq" >= request."snapshotSequence"
                 AND coverage."unrecoverableEpochs" = 0
            )
          )`,
      [input.id, input.userId, input.conversationId]
    );
    const result = await client.query<MessageSearchCountRequestStatus>(
      `SELECT id, state, "exactCount", "expiresAt", "userId", "conversationId",
              "queryHash", "normalizationVersion", "snapshotSequence",
              "membershipSequence", "recoveryGeneration"
         FROM public.message_search_count_requests
        WHERE id = $1 AND "userId" = $2 AND "conversationId" = $3
        LIMIT 1`,
      [input.id, input.userId, input.conversationId]
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
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
      createdAt: Date;
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
              request."membershipWindows", request.attempts, request."createdAt",
              request."expiresAt"
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
      createdAt: row.createdAt,
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
    `WITH current_scope AS MATERIALIZED (
       SELECT request.id,
              request."expiresAt" > now()
                AND conversation.id IS NOT NULL
                AND conversation."changeSeq" = request."snapshotSequence"
                AND conversation."membershipSeq" = request."membershipSequence"
                AND COALESCE(account."recoveryGeneration", 0) = request."recoveryGeneration"
                AND coverage."backfillCompletedAt" IS NOT NULL
                AND coverage."completedChangeSeq" >= request."snapshotSequence"
                AND coverage."unrecoverableEpochs" = 0 AS valid
         FROM public.message_search_count_requests AS request
         LEFT JOIN public.message_conversations AS conversation
           ON conversation.id = request."conversationId"
         LEFT JOIN public.message_search_account_state AS account
           ON account."userId" = request."userId"
         LEFT JOIN public.message_search_coverage AS coverage
           ON coverage."conversationId" = request."conversationId"
        WHERE request.id = $1 AND request.state = 'running'
     )
     UPDATE public.message_search_count_requests AS request
        SET state = CASE WHEN current_scope.valid THEN 'exact' ELSE 'unavailable' END,
            "exactCount" = CASE WHEN current_scope.valid THEN $2::int4 ELSE NULL END,
            fragments = NULL, "membershipWindows" = NULL,
            "leaseUntil" = NULL, "completedAt" = now(), "updatedAt" = now()
       FROM current_scope
      WHERE request.id = current_scope.id AND request.state = 'running'`,
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

export async function listRunnableMessageUnreadCounters(
  limit = 100
): Promise<MessageUnreadCounterMember[]> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  const result = await getSearchPool().query<MessageUnreadCounterMember>(
    `SELECT "conversationId", "userId"
       FROM public.message_conversation_members
      WHERE "unreadCount" IS NULL
      LIMIT $1`,
    [boundedLimit]
  );
  return result.rows;
}

export async function reconcileMessageUnreadCounter(
  input: MessageUnreadCounterMember
): Promise<number | null> {
  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN");
    const conversationResult = await client.query<{ type: string }>(
      `SELECT "type"
         FROM public.message_conversations
        WHERE id = $1
        FOR NO KEY UPDATE`,
      [input.conversationId]
    );
    const [conversation] = conversationResult.rows;
    if (!conversation) {
      await client.query("COMMIT");
      return null;
    }

    const memberResult = await client.query<{
      createdAt: Date;
      lastReadAt: Date | null;
      lastReadSequence: number | null;
      leftAt: Date | null;
      mutedAt: Date | null;
      unreadCount: number | null;
    }>(
      `SELECT "createdAt", "lastReadAt", "lastReadSequence", "leftAt",
              "mutedAt", "unreadCount"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "userId" = $2
        FOR UPDATE`,
      [input.conversationId, input.userId]
    );
    const [member] = memberResult.rows;
    if (!member) {
      await client.query("COMMIT");
      return null;
    }
    if (member.unreadCount !== null) {
      await client.query("COMMIT");
      return member.unreadCount;
    }
    if (member.leftAt !== null || member.mutedAt !== null) {
      await client.query(
        `UPDATE public.message_conversation_members
            SET "unreadCount" = 0
          WHERE "conversationId" = $1 AND "userId" = $2
            AND "unreadCount" IS NULL`,
        [input.conversationId, input.userId]
      );
      await client.query("COMMIT");
      return 0;
    }

    let membershipStart: Date | null = null;
    if (conversation.type === "DEN") {
      const joinedResult = await client.query<{ joinedAt: Date | null }>(
        `SELECT MAX("createdAt") AS "joinedAt"
           FROM public.message_conversation_membership_events
          WHERE "conversationId" = $1
            AND "targetUserId" = $2
            AND action = 'JOINED'`,
        [input.conversationId, input.userId]
      );
      const joinedAt = joinedResult.rows[0]?.joinedAt ?? null;
      membershipStart =
        joinedAt && joinedAt > member.createdAt ? joinedAt : member.createdAt;
    }

    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM public.messages AS message
        WHERE message."conversationId" = $1
          AND message."senderId" <> $2
          AND message."deletedAt" IS NULL
          AND (
            ($4::integer IS NULL AND message."createdAt" > $3)
            OR ($4::integer IS NOT NULL AND (
              message."creationSequence" > $4
              OR (message."creationSequence" = 0 AND message."createdAt" > $3)
            ))
          )
          AND ($5::timestamp IS NULL OR message."createdAt" >= $5)
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_hidden AS hidden
             WHERE hidden."messageId" = message.id
               AND hidden."userId" = $2
          )`,
      [
        input.conversationId,
        input.userId,
        member.lastReadAt ?? new Date(0),
        member.lastReadSequence,
        membershipStart,
      ]
    );
    const unreadCount = Number(countResult.rows[0]?.count ?? "0");
    if (
      !Number.isSafeInteger(unreadCount) ||
      unreadCount < 0 ||
      unreadCount > 2_147_483_647
    ) {
      throw new Error("Unread message count is outside the supported range");
    }

    const updated = await client.query(
      `UPDATE public.message_conversation_members
          SET "unreadCount" = $3
        WHERE "conversationId" = $1 AND "userId" = $2
          AND "unreadCount" IS NULL`,
      [input.conversationId, input.userId, unreadCount]
    );
    await client.query("COMMIT");
    return updated.rowCount === 1 ? unreadCount : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function commitMessageSearchMutation(
  input: MessageSearchMutationInput
): Promise<MessageSearchMutationResult> {
  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN");
    const conversationLock = await client.query(
      `SELECT id
         FROM public.message_conversations
        WHERE id = $1
        FOR UPDATE`,
      [input.conversationId]
    );
    if (conversationLock.rowCount !== 1) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
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

    if (input.kind === "delete") {
      await client.query(
        `UPDATE public.message_conversation_members
            SET "unreadCount" = NULL
          WHERE "conversationId" = $1
            AND "leftAt" IS NULL
            AND "mutedAt" IS NULL`,
        [input.conversationId]
      );
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

export async function commitMessageConversationRead(input: {
  conversationId: string;
  membershipWindows: readonly SearchMessageWindow[];
  userId: string;
}): Promise<MessageReadCommitResult> {
  const client = await getSearchPool().connect();
  try {
    await client.query("BEGIN");
    // This lock serializes the read boundary with changeSeq writers while remaining compatible with message foreign-key KEY SHARE locks.
    const conversationResult = await client.query<{ changeSeq: number }>(
      `SELECT "changeSeq"
         FROM public.message_conversations
        WHERE id = $1
        FOR NO KEY UPDATE`,
      [input.conversationId]
    );
    const [conversation] = conversationResult.rows;
    if (!conversation) {
      await client.query("COMMIT");
      return { status: "conversation-not-found" };
    }

    const membershipResult = await client.query<{
      lastReadAt: Date | null;
      lastReadSequence: number | null;
      leftAt: Date | null;
      mutedAt: Date | null;
    }>(
      `SELECT "lastReadAt", "lastReadSequence", "leftAt", "mutedAt"
         FROM public.message_conversation_members
        WHERE "conversationId" = $1 AND "userId" = $2
        FOR UPDATE`,
      [input.conversationId, input.userId]
    );
    const [member] = membershipResult.rows;
    if (!member) {
      await client.query("COMMIT");
      return { status: "membership-not-found" };
    }
    if (member.leftAt !== null) {
      await client.query("COMMIT");
      return { status: "membership-ended" };
    }

    const values: unknown[] = [
      input.conversationId,
      input.userId,
      member.lastReadAt ?? new Date(0),
    ];
    let readPredicate = `message."createdAt" > $3`;
    if (member.lastReadSequence !== null) {
      values.push(member.lastReadSequence);
      const sequenceParameter = `$${values.length}`;
      readPredicate = `(message."creationSequence" > ${sequenceParameter}
        OR (message."creationSequence" = 0 AND message."createdAt" > $3))`;
    }

    const { membershipWindows } = input;
    const hasOpenMembershipWindow = membershipWindows.some(
      (window) => window.after === null && window.before === null
    );
    let membershipPredicate = "";
    if (membershipWindows.length > 0 && !hasOpenMembershipWindow) {
      const ranges = membershipWindows.map((window) => {
        const bounds: string[] = [];
        if (window.after !== null) {
          values.push(window.after);
          bounds.push(`message."createdAt" >= $${values.length}`);
        }
        if (window.before !== null) {
          values.push(window.before);
          bounds.push(`message."createdAt" <= $${values.length}`);
        }
        return bounds.length === 0 ? "TRUE" : `(${bounds.join(" AND ")})`;
      });
      if (!ranges.includes("TRUE")) {
        membershipPredicate = `AND (${ranges.join(" OR ")})`;
      }
    }

    const unreadResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM public.messages AS message
        WHERE message."conversationId" = $1
          AND message."senderId" <> $2
          AND message."deletedAt" IS NULL
          AND ${readPredicate}
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_hidden AS hidden
             WHERE hidden."messageId" = message.id
               AND hidden."userId" = $2
          )
          ${membershipPredicate}`,
      values
    );
    const countedUnread = Number(unreadResult.rows[0]?.count ?? "0");
    if (!Number.isSafeInteger(countedUnread) || countedUnread < 0) {
      throw new Error("Unread message count is outside the supported range");
    }

    const readSequence = conversation.changeSeq;
    const updatedMembership = await client.query<{ lastReadAt: Date }>(
      `UPDATE public.message_conversation_members
          SET "lastReadAt" = statement_timestamp(),
              "lastDeliveredAt" = statement_timestamp(),
              "lastReadSequence" = $3,
              "unreadCount" = 0
        WHERE "conversationId" = $1 AND "userId" = $2
        RETURNING "lastReadAt"`,
      [input.conversationId, input.userId, readSequence]
    );
    const readAt = updatedMembership.rows[0]?.lastReadAt;
    if (!readAt) {
      throw new Error("Conversation membership disappeared while marking read");
    }

    await client.query("COMMIT");
    return {
      readAt,
      readSequence,
      status: "read",
      unreadCount: member.mutedAt === null ? countedUnread : 0,
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
  membershipWindows?: readonly SearchMessageWindow[];
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
      lastReadSequence: number | null;
      leftAt: Date | null;
      mutedAt: Date | null;
    }>(
      `SELECT "lastReadAt", "lastReadSequence", "leftAt", "mutedAt"
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
      creationSequence: number;
      createdAt: Date;
      deletedAt: Date | null;
      id: string;
      revision: number;
      senderId: string;
    }>(
      `SELECT id, "senderId", "createdAt", "creationSequence", "deletedAt", revision
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
    const visibleWindows = input.membershipWindows ?? [];
    const hasOpenMembershipWindow = visibleWindows.some(
      (window) => window.after === null && window.before === null
    );
    const insertedIdSet = new Set(insertedIds);
    const unreadDecrement = source.rows.filter((row) => {
      const messageAt = row.createdAt.getTime();
      const withinMembership =
        visibleWindows.length === 0 ||
        hasOpenMembershipWindow ||
        visibleWindows.some(
          (window) =>
            (window.after === null || messageAt >= window.after.getTime()) &&
            (window.before === null || messageAt <= window.before.getTime())
        );
      const unread =
        member.lastReadSequence === null
          ? messageAt > readAt
          : row.creationSequence > member.lastReadSequence ||
            (row.creationSequence === 0 && messageAt > readAt);
      return (
        insertedIdSet.has(row.id) &&
        row.senderId !== input.userId &&
        row.deletedAt === null &&
        member.mutedAt === null &&
        unread &&
        withinMembership
      );
    }).length;
    await client.query(
      `UPDATE public.message_conversation_members
          SET "unreadCount" = NULL
        WHERE "conversationId" = $1 AND "userId" = $2`,
      [input.conversationId, input.userId]
    );
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
        `DELETE FROM public.message_search_references
          WHERE "messageId" = $1 AND revision <= $2`,
        [artifact.messageId, artifact.revision]
      );
      if (artifact.references.length > 0) {
        const values: unknown[] = [];
        const tuples = artifact.references.map((reference, index) => {
          const base = index * 8;
          values.push(
            artifact.messageId,
            artifact.conversationId,
            reference.kind,
            reference.ordinal,
            row.createdAt,
            artifact.revision,
            reference.mediaKind ?? null,
            reference.requiredId ?? null
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
        });
        await client.query(
          `INSERT INTO public.message_search_references
             ("messageId", "conversationId", kind, ordinal, "createdAt", revision, "mediaKind", "requiredId")
           VALUES ${tuples.join(",")}
           ON CONFLICT ("messageId", kind, ordinal) DO UPDATE
             SET "conversationId" = EXCLUDED."conversationId",
                 "createdAt" = EXCLUDED."createdAt",
                 revision = EXCLUDED.revision,
                 "mediaKind" = EXCLUDED."mediaKind",
                 "requiredId" = EXCLUDED."requiredId"
           WHERE public.message_search_references.revision <= EXCLUDED.revision`,
          values
        );
      }
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
      await client.query(
        `DELETE FROM public.message_search_references
          WHERE "messageId" = $1 AND revision <= $2`,
        [artifact.messageId, artifact.revision]
      );
      if (!row || row.deletedAt) {
        await client.query(
          `DELETE FROM public.message_search_terms
            WHERE "conversationId" = $1 AND "documentFrequency" = 0`,
          [artifact.conversationId]
        );
      }
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
      const references = currentArtifacts.flatMap((artifact) =>
        artifact.references.map((reference) => ({ artifact, reference }))
      );
      const currentMessageIds = currentArtifacts.map(
        (artifact) => artifact.messageId
      );
      if (currentMessageIds.length > 0) {
        await client.query(
          `DELETE FROM public.message_search_references
            WHERE "conversationId" = $1 AND "messageId" = ANY($2::text[])`,
          [input.conversationId, currentMessageIds]
        );
      }
      if (references.length > 0) {
        const referenceValues: unknown[] = [];
        const referenceTuples = references.map(
          ({ artifact, reference }, index) => {
            const base = index * 8;
            referenceValues.push(
              artifact.messageId,
              input.conversationId,
              reference.kind,
              reference.ordinal,
              artifact.createdAt,
              artifact.revision,
              reference.mediaKind ?? null,
              reference.requiredId ?? null
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
          }
        );
        await client.query(
          `INSERT INTO public.message_search_references
             ("messageId", "conversationId", kind, ordinal, "createdAt", revision, "mediaKind", "requiredId")
           VALUES ${referenceTuples.join(",")}
           ON CONFLICT ("messageId", kind, ordinal) DO UPDATE
             SET "conversationId" = EXCLUDED."conversationId",
                 "createdAt" = EXCLUDED."createdAt",
                 revision = EXCLUDED.revision,
                 "mediaKind" = EXCLUDED."mediaKind",
                 "requiredId" = EXCLUDED."requiredId"
           WHERE public.message_search_references.revision <= EXCLUDED.revision`,
          referenceValues
        );
      }
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

const SEARCH_MESSAGE_CANDIDATES_SQL = `WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids
         FROM query_fragments AS query
         JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
        GROUP BY query.fragment_ordinal
     )
     SELECT m.id,
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
        AND (
          $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
          OR NOT EXISTS (
            SELECT 1
              FROM public.message_search_outbox AS newer_revision
             WHERE newer_revision."messageId" = m.id
               AND newer_revision."changeSequence" > $4
          )
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
        AND (SELECT COUNT(*) FROM matching_terms) =
            (SELECT COUNT(*) FROM query_fragments)
        AND NOT EXISTS (
          SELECT 1
            FROM matching_terms AS matched_term
           WHERE NOT d."termIds" && matched_term.term_ids
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
      LIMIT $8`;

const SEARCH_FRAGMENT_FREQUENCY_SQL = `WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     fragment_terms AS (
       SELECT query.fragment_ordinal,
              term.id,
              term."documentFrequency"
         FROM query_fragments AS query
         LEFT JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
     )
     SELECT query.fragment_ordinal::int AS "fragmentOrdinal",
            COALESCE(SUM(fragment_terms."documentFrequency"), 0)::text AS "candidateCount",
            COALESCE(
              ARRAY_AGG(fragment_terms.id) FILTER (WHERE fragment_terms.id IS NOT NULL),
              ARRAY[]::int[]
            ) AS "termIds"
       FROM query_fragments AS query
       LEFT JOIN fragment_terms
         ON fragment_terms.fragment_ordinal = query.fragment_ordinal
      GROUP BY query.fragment_ordinal
      ORDER BY COALESCE(SUM(fragment_terms."documentFrequency"), 0) ASC,
               query.fragment_ordinal ASC
      LIMIT 1`;

const SEARCH_ORDERED_DOCUMENT_PAGE_SQL = `WITH ordered_documents AS MATERIALIZED (
       SELECT d."conversationId",
              d."createdAt",
              d."messageId",
              d.revision
         FROM public.message_search_documents AS d
        WHERE d."conversationId" = $1
          AND (
            $2::timestamp IS NULL OR
            (d."createdAt", d."messageId") < ($2::timestamp, $3::text)
          )
        ORDER BY d."createdAt" DESC, d."messageId" DESC
        LIMIT $4
     ),
     scan_state AS (
       SELECT COUNT(*)::int AS "scannedCount",
              (ARRAY_AGG("createdAt" ORDER BY "createdAt" ASC, "messageId" ASC))[1] AS "scannedThroughCreatedAt",
              (ARRAY_AGG("messageId" ORDER BY "createdAt" ASC, "messageId" ASC))[1] AS "scannedThroughMessageId"
         FROM ordered_documents
     ),
     authorized_documents AS (
       SELECT d."createdAt",
              d."messageId"
         FROM ordered_documents AS d
         JOIN public.messages AS m
           ON m.id = d."messageId"
          AND m."conversationId" = d."conversationId"
          AND m.revision = d.revision
         JOIN public.message_conversation_members AS member
           ON member."conversationId" = d."conversationId"
          AND member."userId" = $5
        WHERE m."deletedAt" IS NULL
          AND m."keyEpoch" IS NOT NULL
          AND m."creationSequence" <= $6
          AND (
            $6 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = m.id
                 AND newer_revision."changeSequence" > $6
            )
          )
          AND EXISTS (
            SELECT 1
              FROM public.message_conversation_keys AS readable_key
             WHERE readable_key."conversationId" = d."conversationId"
               AND readable_key."ownerUserId" = $5
               AND readable_key.version = m."keyEpoch"
          )
          AND NOT EXISTS (
            SELECT 1
              FROM public.message_hidden AS hidden
             WHERE hidden."messageId" = m.id AND hidden."userId" = $5
          )
          AND (
            $7::jsonb IS NULL OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements($7::jsonb) AS membership_window
               WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
                 AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
            )
          )
     )
     SELECT authorized."createdAt",
            authorized."messageId",
            scan_state."scannedCount",
            scan_state."scannedThroughCreatedAt",
            scan_state."scannedThroughMessageId"
       FROM scan_state
       LEFT JOIN authorized_documents AS authorized ON true
      WHERE scan_state."scannedCount" > 0
      ORDER BY authorized."createdAt" DESC, authorized."messageId" DESC`;

const SEARCH_ORDERED_CANDIDATE_HITS_SQL = `WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids
         FROM query_fragments AS query
         JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
        GROUP BY query.fragment_ordinal
     ),
     candidate_documents AS MATERIALIZED (
       SELECT d."conversationId",
              d."messageId",
              d.revision,
              d."createdAt"
         FROM public.message_search_documents AS d
        WHERE d."conversationId" = $1
          AND d."messageId" = ANY($9::text[])
          AND (
            $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = d."messageId"
                 AND newer_revision."changeSequence" > $4
            )
          )
          AND (SELECT COUNT(*) FROM matching_terms) =
              (SELECT COUNT(*) FROM query_fragments)
          AND NOT EXISTS (
            SELECT 1
              FROM matching_terms AS matched_term
             WHERE NOT d."termIds" && matched_term.term_ids
          )
          AND (
            $5::timestamp IS NULL OR
            (d."createdAt", d."messageId") < ($5::timestamp, $6::text)
          )
     )
     SELECT m.id,
            m."ciphertext",
            m.iv,
            m."ratchetIndex",
            m."senderId",
            m."createdAt",
            m.revision,
            m."keyEpoch"
       FROM candidate_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
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
        AND (
          $7::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($7::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
      ORDER BY d."createdAt" DESC, d."messageId" DESC
      LIMIT $8`;

const SEARCH_MESSAGE_CANDIDATES_SELECTIVE_SQL = `WITH query_fragments AS MATERIALIZED (
       SELECT value, ordinality AS fragment_ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS fragment(value, ordinality)
     ),
     matching_terms AS MATERIALIZED (
       SELECT query.fragment_ordinal,
              ARRAY_AGG(term.id) AS term_ids
         FROM query_fragments AS query
         JOIN public.message_search_terms AS term
           ON term."conversationId" = $1
          AND term."gramKeys" @> ARRAY(
            SELECT jsonb_array_elements_text(query.value->'grams')
          )
          AND strpos(term.normalized, query.value->>'text') > 0
        GROUP BY query.fragment_ordinal
     ),
     candidate_documents AS MATERIALIZED (
       SELECT d."conversationId",
              d."messageId",
              d.revision,
              d."createdAt"
         FROM public.message_search_documents AS d
        WHERE d."conversationId" = $1
          AND d."termIds" && $9::int[]
          AND (
            $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = d."messageId"
                 AND newer_revision."changeSequence" > $4
            )
          )
          AND (SELECT COUNT(*) FROM matching_terms) =
              (SELECT COUNT(*) FROM query_fragments)
          AND NOT EXISTS (
            SELECT 1
              FROM matching_terms AS matched_term
             WHERE NOT d."termIds" && matched_term.term_ids
          )
          AND (
            $5::timestamp IS NULL OR
            (d."createdAt", d."messageId") < ($5::timestamp, $6::text)
          )
     )
     SELECT m.id,
            m."ciphertext",
            m.iv,
            m."ratchetIndex",
            m."senderId",
            m."createdAt",
            m.revision,
            m."keyEpoch"
       FROM candidate_documents AS d
       JOIN public.messages AS m
         ON m.id = d."messageId"
        AND m."conversationId" = d."conversationId"
        AND m.revision = d.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = d."conversationId"
        AND member."userId" = $2
      WHERE m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND m."creationSequence" <= $4
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
        AND (
          $7::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($7::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
      ORDER BY d."createdAt" DESC, d."messageId" DESC
      LIMIT $8`;

const SEARCH_SELECTIVE_CANDIDATE_THRESHOLD = 1000;
const ORDERED_SEARCH_SCAN_BATCH_SIZE = 100;

interface SearchCandidatePlanNode {
  "Actual Loops"?: number;
  "Actual Rows"?: number;
  "Actual Total Time"?: number;
  "Index Name"?: string;
  "Node Type": string;
  "Relation Name"?: string;
  "Rows Removed by Filter"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: SearchCandidatePlanNode[];
}

interface SearchCandidateExplainRow {
  "QUERY PLAN": {
    "Execution Time": number;
    "Planning Time": number;
    Plan: SearchCandidatePlanNode;
  }[];
}

function searchCandidateQueryParameters(input: SearchCandidateQuery) {
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  return [
    input.conversationId,
    input.userId,
    JSON.stringify(input.fragments),
    input.snapshotSequence,
    input.before ? pgTimestamp(input.before.createdAt) : null,
    input.before?.messageId ?? null,
    JSON.stringify(windows),
    Math.min(Math.max(Math.trunc(input.limit), 1), 21),
  ];
}

function searchCandidatePlanNodes(
  node: SearchCandidatePlanNode
): SearchCandidatePlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(searchCandidatePlanNodes)];
}

// Kept off the package barrel so integration benchmarks can inspect the exact production query plan.
export async function explainSearchMessageCandidatesForDiagnostics(
  input: SearchCandidateQuery & {
    candidateMessageIds?: readonly string[];
    indexedTermIds?: readonly number[];
    strategy?: "ordered" | "orderedHits" | "selective";
  }
): Promise<{
  executionTimeMs: number;
  indexNames: string[];
  planNodes: {
    actualLoops?: number;
    actualRows?: number;
    actualTotalTimeMs?: number;
    indexName?: string;
    nodeType: string;
    relationName?: string;
    rowsRemovedByFilter?: number;
    sharedHitBlocks?: number;
    sharedReadBlocks?: number;
  }[];
  nodeTypes: string[];
  planningTimeMs: number;
  sharedHitBlocks: number;
  sharedReadBlocks: number;
} | null> {
  const queryParameters = searchCandidateQueryParameters(input);
  const { candidateMessageIds, indexedTermIds, strategy } = input;
  let sql = SEARCH_MESSAGE_CANDIDATES_SQL;
  const parameters: SearchSqlParameter[] = [...queryParameters];
  if (strategy === "ordered") {
    sql = SEARCH_ORDERED_DOCUMENT_PAGE_SQL;
    parameters.splice(
      0,
      parameters.length,
      input.conversationId,
      input.before ? pgTimestamp(input.before.createdAt) : null,
      input.before?.messageId ?? null,
      ORDERED_SEARCH_SCAN_BATCH_SIZE,
      input.userId,
      input.snapshotSequence,
      queryParameters[6]
    );
  } else if (strategy === "orderedHits") {
    if (
      !candidateMessageIds ||
      candidateMessageIds.length === 0 ||
      candidateMessageIds.length > ORDERED_SEARCH_SCAN_BATCH_SIZE
    ) {
      throw new TypeError("The ordered search candidate IDs are invalid");
    }
    sql = SEARCH_ORDERED_CANDIDATE_HITS_SQL;
    parameters.push([...candidateMessageIds]);
  } else if (indexedTermIds !== undefined) {
    sql = SEARCH_MESSAGE_CANDIDATES_SELECTIVE_SQL;
    parameters.push([...indexedTermIds]);
  }
  if (
    indexedTermIds !== undefined &&
    (indexedTermIds.length === 0 ||
      indexedTermIds.some(
        (termId) => !Number.isSafeInteger(termId) || termId < 1
      ))
  ) {
    throw new TypeError("The indexed search terms are invalid");
  }
  const result = await getSearchPool().query<SearchCandidateExplainRow>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    parameters
  );
  const plan = result.rows[0]?.["QUERY PLAN"][0];
  if (!plan) {
    return null;
  }
  const nodes = searchCandidatePlanNodes(plan.Plan);
  return {
    executionTimeMs: plan["Execution Time"],
    indexNames: nodes.flatMap((node) =>
      node["Index Name"] ? [node["Index Name"]] : []
    ),
    nodeTypes: nodes.map((node) => node["Node Type"]),
    planNodes: nodes.map((node) => ({
      actualLoops: node["Actual Loops"],
      actualRows: node["Actual Rows"],
      actualTotalTimeMs: node["Actual Total Time"],
      indexName: node["Index Name"],
      nodeType: node["Node Type"],
      relationName: node["Relation Name"],
      rowsRemovedByFilter: node["Rows Removed by Filter"],
      sharedHitBlocks: node["Shared Hit Blocks"],
      sharedReadBlocks: node["Shared Read Blocks"],
    })),
    planningTimeMs: plan["Planning Time"],
    sharedHitBlocks: plan.Plan["Shared Hit Blocks"] ?? 0,
    sharedReadBlocks: plan.Plan["Shared Read Blocks"] ?? 0,
  };
}

export async function searchMessageCandidates(
  input: SearchCandidateQuery
): Promise<SearchCandidateRow[]> {
  const pool = getSearchPool();
  const queryParameters = searchCandidateQueryParameters(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const frequency = await client.query<{
      candidateCount: string;
      fragmentOrdinal: number;
      termIds: number[];
    }>(SEARCH_FRAGMENT_FREQUENCY_SQL, [queryParameters[0], queryParameters[2]]);
    const [selectiveFragment] = frequency.rows;
    if (!selectiveFragment) {
      throw new Error("Postgres did not return a DM search fragment estimate");
    }
    if (!Number.isSafeInteger(selectiveFragment.fragmentOrdinal)) {
      throw new TypeError(
        "Postgres returned an invalid DM search fragment ordinal"
      );
    }
    if (!/^\d+$/u.test(selectiveFragment.candidateCount)) {
      throw new Error(
        "Postgres returned an invalid DM search candidate estimate"
      );
    }
    if (
      !Array.isArray(selectiveFragment.termIds) ||
      selectiveFragment.termIds.some(
        (termId) => !Number.isSafeInteger(termId) || termId < 1
      )
    ) {
      throw new Error("Postgres returned invalid DM search term identifiers");
    }
    const candidateCount = BigInt(selectiveFragment.candidateCount);
    if (candidateCount === 0n) {
      await client.query("COMMIT");
      return [];
    }
    const useSelectiveQuery =
      candidateCount <= BigInt(SEARCH_SELECTIVE_CANDIDATE_THRESHOLD);
    const useOrderedQuery =
      input.fragments.length === 1 && candidateCount >= 10_000n;
    if (useOrderedQuery) {
      const resultLimit = Math.min(Math.max(Math.trunc(input.limit), 1), 21);
      const results: SearchCandidateRow[] = [];
      let scanBefore = input.before;
      // oxlint-disable no-await-in-loop -- Continue from each document batch until the authorized hit page is full.
      while (results.length < resultLimit) {
        const scannedDocuments = await client.query<OrderedSearchDocumentRow>(
          SEARCH_ORDERED_DOCUMENT_PAGE_SQL,
          [
            input.conversationId,
            scanBefore ? pgTimestamp(scanBefore.createdAt) : null,
            scanBefore?.messageId ?? null,
            ORDERED_SEARCH_SCAN_BATCH_SIZE,
            input.userId,
            input.snapshotSequence,
            queryParameters[6],
          ]
        );
        const [scanState] = scannedDocuments.rows;
        if (
          !scanState ||
          scanState.scannedCount < 1 ||
          !scanState.scannedThroughCreatedAt ||
          !scanState.scannedThroughMessageId
        ) {
          break;
        }

        const candidateMessageIds = scannedDocuments.rows.flatMap((row) =>
          row.messageId ? [row.messageId] : []
        );
        if (candidateMessageIds.length > 0) {
          const remaining = resultLimit - results.length;
          const candidateParameters: SearchSqlParameter[] = [
            ...queryParameters,
          ];
          candidateParameters[7] = remaining;
          candidateParameters.push(candidateMessageIds);
          const candidates = await client.query<SearchCandidateRow>(
            SEARCH_ORDERED_CANDIDATE_HITS_SQL,
            candidateParameters
          );
          results.push(...candidates.rows);
        }
        scanBefore = {
          createdAt: scanState.scannedThroughCreatedAt,
          messageId: scanState.scannedThroughMessageId,
        };
        if (scanState.scannedCount < ORDERED_SEARCH_SCAN_BATCH_SIZE) {
          break;
        }
      }
      // oxlint-enable no-await-in-loop
      await client.query("COMMIT");
      return results;
    }
    const result = await client.query<SearchCandidateRow>(
      useSelectiveQuery
        ? SEARCH_MESSAGE_CANDIDATES_SELECTIVE_SQL
        : SEARCH_MESSAGE_CANDIDATES_SQL,
      useSelectiveQuery
        ? [...queryParameters, selectiveFragment.termIds]
        : queryParameters
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function listMessageSearchReferences(
  input: SearchReferenceQuery
): Promise<SearchReferenceRow[]> {
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  const result = await getSearchPool().query<SearchReferenceRow>(
    `SELECT reference."createdAt",
            reference."messageId",
            reference.ordinal,
            reference.revision,
            reference."mediaKind",
            reference."requiredId",
            message."keyEpoch",
            message."ratchetIndex",
            message."senderId"
       FROM public.message_search_references AS reference
       JOIN public.messages AS message
         ON message.id = reference."messageId"
        AND message."conversationId" = reference."conversationId"
        AND message.revision = reference.revision
       JOIN public.message_search_documents AS document
         ON document."messageId" = message.id
        AND document."conversationId" = message."conversationId"
        AND document.revision = message.revision
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = message."conversationId"
        AND member."userId" = $2
      WHERE reference."conversationId" = $1
        AND reference.kind = $3
        AND message."deletedAt" IS NULL
        AND message."keyEpoch" IS NOT NULL
        AND message."creationSequence" <= $4
        AND (
          $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
          OR NOT EXISTS (
            SELECT 1
              FROM public.message_search_outbox AS newer_revision
             WHERE newer_revision."messageId" = message.id
               AND newer_revision."changeSequence" > $4
          )
        )
        AND EXISTS (
          SELECT 1
            FROM public.message_conversation_keys AS readable_key
           WHERE readable_key."conversationId" = message."conversationId"
             AND readable_key."ownerUserId" = $2
             AND readable_key.version = message."keyEpoch"
        )
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = message.id AND hidden."userId" = $2
        )
        AND (
          $8::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($8::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR message."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR message."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
        AND (
          $5::timestamp IS NULL OR
          (reference."createdAt", reference."messageId") < ($5::timestamp, $6::text) OR
          (reference."createdAt", reference."messageId") = ($5::timestamp, $6::text)
            AND reference.ordinal > $7
        )
      ORDER BY reference."createdAt" DESC, reference."messageId" DESC, reference.ordinal ASC
      LIMIT $9`,
    [
      input.conversationId,
      input.userId,
      input.kind,
      input.snapshotSequence,
      input.after ? pgTimestamp(input.after.createdAt) : null,
      input.after?.messageId ?? null,
      input.after?.ordinal ?? null,
      JSON.stringify(windows),
      Math.min(Math.max(Math.trunc(input.limit), 1), 101),
    ]
  );
  return result.rows;
}

export async function hydrateSearchMessageCandidates(
  input: SearchHydrationQuery
): Promise<SearchCandidateRow[]> {
  if (input.messages.length < 1 || input.messages.length > 20) {
    throw new RangeError(
      "A search hydration batch must contain 1 to 20 messages"
    );
  }
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  const requested = input.messages.map((message) => {
    if (
      message.id.length === 0 ||
      !Number.isSafeInteger(message.revision) ||
      message.revision > 2_147_483_647 ||
      message.revision < 1
    ) {
      throw new TypeError("Search hydration identifiers are invalid");
    }
    return message;
  });
  const result = await getSearchPool().query<SearchCandidateRow>(
    `WITH requested AS (
       SELECT value->>'id' AS id,
              (value->>'revision')::integer AS revision,
              ordinal
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS request(value, ordinal)
     )
     SELECT m.id,
            m."ciphertext",
            m."createdAt",
            m.iv,
            m."keyEpoch",
            m."ratchetIndex",
            m.revision,
            m."senderId"
       FROM requested AS request
       JOIN public.messages AS m
         ON m.id = request.id
        AND m.revision = request.revision
        AND m."conversationId" = $1
       JOIN public.message_conversation_members AS member
         ON member."conversationId" = m."conversationId"
        AND member."userId" = $2
      WHERE m."deletedAt" IS NULL
        AND m."keyEpoch" IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.message_conversation_keys AS readable_key
           WHERE readable_key."conversationId" = m."conversationId"
             AND readable_key."ownerUserId" = $2
             AND readable_key.version = m."keyEpoch"
        )
        AND NOT EXISTS (
          SELECT 1
            FROM public.message_hidden AS hidden
           WHERE hidden."messageId" = m.id AND hidden."userId" = $2
        )
        AND (
          $4::jsonb IS NULL OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements($4::jsonb) AS membership_window
             WHERE (membership_window.value->>'after' IS NULL OR m."createdAt" >= (membership_window.value->>'after')::timestamp)
               AND (membership_window.value->>'before' IS NULL OR m."createdAt" <= (membership_window.value->>'before')::timestamp)
          )
        )
      ORDER BY request.ordinal`,
    [
      input.conversationId,
      input.userId,
      JSON.stringify(requested),
      JSON.stringify(windows),
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
          AND (
            $4 >= (SELECT "changeSeq" FROM public.message_conversations WHERE id = $1)
            OR NOT EXISTS (
              SELECT 1
                FROM public.message_search_outbox AS newer_revision
               WHERE newer_revision."messageId" = m.id
                 AND newer_revision."changeSequence" > $4
            )
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

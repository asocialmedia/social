// oxlint-disable-next-line typescript/triple-slash-reference -- Consumers typecheck workspace sources without including this package's ambient declarations.
/// <reference path="../../../sql.d.ts" />
import { createHash, randomUUID } from "node:crypto";

import { and } from "@prisma/orm-postgres/orm-client";

import prisma from "../../prisma";
import type { PrismaTransaction } from "../../prisma";
import {
  persistMessageSearchEpochProofs,
  readableMessageKeyEpochsSql,
  MESSAGE_VIEWER_EPOCH_COVERAGE_SQL,
  UNVERIFIED_CONVERSATION_EPOCH_SQL,
} from "../epochs/epoch-readability";
import type { MessageSearchEpochProof } from "../epochs/epoch-readability";
import { rawExecute, rawQuery } from "../infrastructure/raw-sql";
import { renderSql } from "../infrastructure/sql-template";
import { messageSearchSql } from "./queries";

const MAX_SEARCH_TERM_INSERT_BATCH = 100;
export const MESSAGE_SEARCH_BACKFILL_BATCH_MESSAGES = 100;
export const MESSAGE_SEARCH_BACKFILL_BATCH_BYTES = 1024 * 1024;
type SearchSqlParameter = number | string | null | number[] | string[];

export interface MessageIdentityBackupRefreshInput {
  encryptedPrivateKey: string;
  expectedUpdatedAt: Date;
  kdfIterations: number;
  masterKeyHash: string;
  nextUpdatedAt: Date;
  publicKey: string;
  salt: string;
  userId: string;
}

export type MessageIdentityBackupRefreshResult =
  | { status: "conflict" }
  | {
      recoveryGeneration: number;
      repairConversationIds: string[];
      status: "updated";
    };

export async function commitMessageIdentityBackupRefresh(
  input: MessageIdentityBackupRefreshInput
): Promise<MessageIdentityBackupRefreshResult> {
  return await prisma.transaction(async (tx) => {
    const identity = await rawQuery<{ userId: string }>(
      messageSearchSql.commitMessageIdentityBackupRefresh.identity,
      [
        input.userId,
        input.publicKey,
        input.expectedUpdatedAt,
        input.encryptedPrivateKey,
        input.masterKeyHash,
        input.salt,
        input.kdfIterations,
        input.nextUpdatedAt,
      ],
      { userId: "pg/text@1" },
      tx
    );
    if (identity.rows.length !== 1) {
      return { status: "conflict" };
    }

    const affected = await rawQuery<{
      changeSeq: number;
      conversationId: string;
    }>(
      messageSearchSql.commitMessageIdentityBackupRefresh.affected,
      [input.userId],
      { changeSeq: "pg/int4@1", conversationId: "pg/text@1" },
      tx
    );
    const conversationIds = affected.rows.map((row) => row.conversationId);
    if (conversationIds.length === 0) {
      const accountState = await rawQuery<{ recoveryGeneration: number }>(
        messageSearchSql.commitMessageIdentityBackupRefresh.accountState,
        [input.userId],
        { recoveryGeneration: "pg/int4@1" },
        tx
      );

      return {
        recoveryGeneration: accountState.rows[0]?.recoveryGeneration ?? 0,
        repairConversationIds: [],
        status: "updated",
      };
    }

    await rawQuery(
      messageSearchSql.commitMessageIdentityBackupRefresh.selectSearchCoverage,
      [conversationIds],
      { conversationId: "pg/text@1" },
      tx
    );
    await rawExecute(
      messageSearchSql.commitMessageIdentityBackupRefresh
        .insertSearchAccountState,
      [input.userId],
      tx
    );
    const accountState = await rawQuery<{ recoveryGeneration: number }>(
      messageSearchSql.commitMessageIdentityBackupRefresh.lockedAccountState,
      [input.userId],
      { recoveryGeneration: "pg/int4@1" },
      tx
    );
    const [lockedAccountState] = accountState.rows;
    if (!lockedAccountState) {
      throw new Error(
        "Message recovery state disappeared during history repair"
      );
    }
    const currentRecoveryGeneration = lockedAccountState.recoveryGeneration;
    if (currentRecoveryGeneration >= 2_147_483_647) {
      throw new Error(
        "Message recovery generation is outside the supported range"
      );
    }
    const recoveryGeneration = currentRecoveryGeneration + 1;
    const repairConversationIds: string[] = [];

    for (const conversationId of conversationIds) {
      // oxlint-disable-next-line no-await-in-loop -- Recovery repairs lock and advance conversations in stable order.
      const coverageState = await rawQuery<{
        backfillCompletedAt: Date | null;
        backfillStartedAt: Date | null;
        unrecoverableEpochs: number;
      }>(
        messageSearchSql.commitMessageIdentityBackupRefresh.coverageState,
        [conversationId],
        {
          backfillCompletedAt: {
            codecId: "pg/timestamp-temporal@1",
            nullable: true,
          },
          backfillStartedAt: {
            codecId: "pg/timestamp-temporal@1",
            nullable: true,
          },
          unrecoverableEpochs: "pg/int4@1",
        },
        tx
      );
      const [coverage] = coverageState.rows;
      if (!coverage) {
        continue;
      }

      // oxlint-disable-next-line no-await-in-loop -- Each durable sequence depends on its locked conversation row.
      const bumpedConversation = await rawQuery<{ changeSeq: number }>(
        messageSearchSql.commitMessageIdentityBackupRefresh.bumpedConversation,
        [conversationId],
        { changeSeq: "pg/int4@1" },
        tx
      );
      const changeSequence = bumpedConversation.rows[0]?.changeSeq;
      if (changeSequence === undefined) {
        throw new Error(
          "Message conversation disappeared during recovery repair"
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Keep the coverage reset in the same transaction as its sequence bump.
      const resetCoverage = await rawExecute(
        messageSearchSql.commitMessageIdentityBackupRefresh.resetCoverage,
        [conversationId, changeSequence],
        tx
      );
      if (resetCoverage.affectedRows !== 1) {
        throw new Error(
          "DM search coverage disappeared during recovery repair"
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Insert the matching durable change before releasing its conversation lock.
      await rawExecute(
        messageSearchSql.commitMessageIdentityBackupRefresh
          .insertConversationChanges,
        [randomUUID(), conversationId, changeSequence, input.userId],
        tx
      );
      repairConversationIds.push(conversationId);
    }

    let finalRecoveryGeneration = currentRecoveryGeneration;
    if (repairConversationIds.length > 0) {
      const updatedState = await rawQuery<{ recoveryGeneration: number }>(
        messageSearchSql.commitMessageIdentityBackupRefresh.updatedState,
        [input.userId, recoveryGeneration],
        { recoveryGeneration: "pg/int4@1" },
        tx
      );
      const [savedAccountState] = updatedState.rows;
      if (!savedAccountState) {
        throw new Error("Message recovery state disappeared during refresh");
      }
      finalRecoveryGeneration = savedAccountState.recoveryGeneration;
    }

    return {
      recoveryGeneration: finalRecoveryGeneration,
      repairConversationIds,
      status: "updated",
    };
  });
}

async function lockMessageSearchCoverageRow(
  tx: PrismaTransaction,
  conversationId: string
): Promise<void> {
  await rawExecute(
    messageSearchSql.lockMessageSearchCoverageRow.insertSearchCoverage,
    [conversationId],
    tx
  );
  const locked = await rawQuery(
    messageSearchSql.lockMessageSearchCoverageRow.locked,
    [conversationId],
    { conversationId: "pg/text@1" },
    tx
  );
  if (locked.rows.length !== 1) {
    throw new Error("DM search coverage row could not be locked");
  }
}

async function refreshUnreadableSearchCoverage(
  tx: PrismaTransaction,
  conversationId: string
): Promise<void> {
  const coverage = await rawQuery<{
    hasUnreadableMessages: boolean;
    unrecoverableEpochIds: number[];
  }>(
    messageSearchSql.refreshUnreadableSearchCoverage.coverage,
    [conversationId],
    { hasUnreadableMessages: "pg/bool@1", unrecoverableEpochIds: "pg/jsonb@1" },
    tx
  );
  const [current] = coverage.rows;
  if (!current) {
    throw new Error("DM search coverage could not be recalculated");
  }
  const updated = await rawExecute(
    messageSearchSql.refreshUnreadableSearchCoverage.updated,
    [
      conversationId,
      current.unrecoverableEpochIds,
      current.hasUnreadableMessages,
    ],
    tx
  );
  if (updated.affectedRows !== 1) {
    throw new Error("DM search coverage disappeared during recalculation");
  }
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
  epochProofs?: readonly MessageSearchEpochProof[];
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
  // Newer pages return nearest-first so callers can trim the lookahead before reversing.
  after?: { createdAt: Date; messageId: string };
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
  before?: SearchReferenceCursor;
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
  epochProofs?: readonly MessageSearchEpochProof[];
  createdAt: Date;
  keyEpoch: number;
  messageId: string;
  references: readonly SearchReferenceArtifact[];
  revision: number;
  terms: readonly SearchTermArtifact[];
}

export interface MessageSearchBackfillOutcome {
  keyEpoch: number | null;
  messageId: string;
  revision: number;
  status: "deleted" | "indexed" | "unreadable";
  unrecoverableEpoch: boolean;
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
  const requestKey = messageSearchCountRequestKey(input);
  return await prisma.transaction(async (tx) => {
    await rawExecute(
      messageSearchSql.requestMessageSearchCount.advisoryLock,
      [`${input.userId}:${input.conversationId}`],
      tx
    );
    const existingResult = await rawQuery<{
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
      messageSearchSql.requestMessageSearchCount.existing,
      [requestKey],
      {
        conversationId: "pg/text@1",
        exactCount: { codecId: "pg/int4@1", nullable: true },
        expiresAt: "pg/timestamp-temporal@1",
        id: "pg/text@1",
        membershipSequence: "pg/int4@1",
        normalizationVersion: "pg/int4@1",
        queryHash: "pg/text@1",
        recoveryGeneration: "pg/int4@1",
        snapshotSequence: "pg/int4@1",
        state: "pg/text@1",
        userId: "pg/text@1",
      },
      tx
    );
    const [existing] = existingResult.rows;
    if (
      existing &&
      existing.expiresAt.getTime() > Date.now() &&
      ["pending", "running", "exact"].includes(existing.state)
    ) {
      await rawExecute(
        messageSearchSql.requestMessageSearchCount.cancelOtherRequests,
        [input.userId, input.conversationId, existing.id],
        tx
      );

      return existing;
    }
    if (existing) {
      await tx.orm.public.MessageSearchCountRequests.where({
        id: existing.id,
      }).deleteAndCount();
    }
    await rawExecute(
      messageSearchSql.requestMessageSearchCount.cancelRequests,
      [input.userId, input.conversationId],
      tx
    );
    const inserted = await rawQuery<{
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
      messageSearchSql.requestMessageSearchCount.inserted,
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
      ],
      {
        conversationId: "pg/text@1",
        exactCount: { codecId: "pg/int4@1", nullable: true },
        expiresAt: "pg/timestamp-temporal@1",
        id: "pg/text@1",
        membershipSequence: "pg/int4@1",
        normalizationVersion: "pg/int4@1",
        queryHash: "pg/text@1",
        recoveryGeneration: "pg/int4@1",
        snapshotSequence: "pg/int4@1",
        state: "pg/text@1",
        userId: "pg/text@1",
      },
      tx
    );
    const [created] = inserted.rows;
    if (!created) {
      throw new Error("Search count request insert returned no row");
    }

    return created;
  });
}

export async function getMessageSearchCountRequestStatus(input: {
  id: string;
  userId: string;
  conversationId: string;
}): Promise<MessageSearchCountRequestStatus | null> {
  return await prisma.transaction(async (tx) => {
    await rawExecute(
      messageSearchSql.getMessageSearchCountRequestStatus.isolation,
      [],
      tx
    );
    await rawExecute(
      messageSearchSql.getMessageSearchCountRequestStatus
        .updateSearchCountRequests,
      [input.id, input.userId, input.conversationId],
      tx
    );
    const result = await rawQuery<MessageSearchCountRequestStatus>(
      messageSearchSql.getMessageSearchCountRequestStatus.result,
      [input.id, input.userId, input.conversationId],
      {
        conversationId: "pg/text@1",
        exactCount: { codecId: "pg/int4@1", nullable: true },
        expiresAt: "pg/timestamp-temporal@1",
        id: "pg/text@1",
        membershipSequence: "pg/int4@1",
        normalizationVersion: "pg/int4@1",
        queryHash: "pg/text@1",
        recoveryGeneration: "pg/int4@1",
        snapshotSequence: "pg/int4@1",
        state: "pg/text@1",
        userId: "pg/text@1",
      },
      tx
    );

    return result.rows[0] ?? null;
  });
}

export async function listRunnableMessageSearchCounts(
  limit: number
): Promise<string[]> {
  const result = await rawQuery<{ id: string }>(
    messageSearchSql.listRunnableMessageSearchCounts.result,
    [Math.min(Math.max(Math.trunc(limit), 1), 100)],
    { id: "pg/text@1" }
  );
  return result.rows.map((row) => row.id);
}

export async function expireStaleMessageSearchCounts(): Promise<void> {
  await rawExecute(
    messageSearchSql.expireStaleMessageSearchCounts.updateSearchCountRequests,
    []
  );
}

export async function claimMessageSearchCountRequest(
  id: string
): Promise<MessageSearchCountRequest | null> {
  return await prisma.transaction(async (tx) => {
    const selected = await rawQuery<{
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
      messageSearchSql.claimMessageSearchCountRequest.selected,
      [id],
      {
        attempts: "pg/int4@1",
        conversationId: "pg/text@1",
        createdAt: "pg/timestamp-temporal@1",
        expiresAt: "pg/timestamp-temporal@1",
        fragments: "pg/jsonb@1",
        id: "pg/text@1",
        membershipSequence: "pg/int4@1",
        membershipWindows: "pg/jsonb@1",
        normalizationVersion: "pg/int4@1",
        queryHash: "pg/text@1",
        recoveryGeneration: "pg/int4@1",
        snapshotSequence: "pg/int4@1",
        userId: "pg/text@1",
      },
      tx
    );
    const [row] = selected.rows;
    if (!row) {
      return null;
    }
    const fragments = decodeCountFragments(row.fragments);
    const membershipWindows = decodeCountWindows(row.membershipWindows);
    if (!fragments || !membershipWindows) {
      await rawExecute(
        messageSearchSql.claimMessageSearchCountRequest
          .updateSearchCountRequests,
        [id],
        tx
      );

      return null;
    }
    if (row.attempts >= 8) {
      await rawExecute(
        messageSearchSql.claimMessageSearchCountRequest
          .updateSearchCountRequests2,
        [id],
        tx
      );

      return null;
    }
    const lease = await rawExecute(
      messageSearchSql.claimMessageSearchCountRequest.lease,
      [id],
      tx
    );
    if (lease.affectedRows !== 1) {
      throw new Error("Search count request lease was not acquired");
    }

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
  });
}

export async function completeMessageSearchCountRequest(
  id: string,
  exactCount: number
): Promise<void> {
  if (!Number.isSafeInteger(exactCount) || exactCount < 0) {
    throw new Error("Search count result is outside the supported range");
  }
  await rawExecute(
    messageSearchSql.completeMessageSearchCountRequest.withSearchCountRequests,
    [id, exactCount]
  );
}

export async function releaseMessageSearchCountRequest(
  id: string
): Promise<void> {
  await rawExecute(
    messageSearchSql.releaseMessageSearchCountRequest.updateSearchCountRequests,
    [id]
  );
}

export async function listRunnableMessageUnreadCounters(
  limit = 100
): Promise<MessageUnreadCounterMember[]> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  return await prisma.orm.public.MessageConversationMembers.select(
    "conversationId",
    "userId"
  )
    .where((member) => member.unreadCount.isNull())
    .limit(boundedLimit)
    .all();
}

export async function reconcileMessageUnreadCounter(
  input: MessageUnreadCounterMember
): Promise<number | null> {
  return await prisma.transaction(async (tx) => {
    const conversationResult = await rawQuery<{ type: string }>(
      messageSearchSql.reconcileMessageUnreadCounter.conversation,
      [input.conversationId],
      { type: "pg/text@1" },
      tx
    );
    const [conversation] = conversationResult.rows;
    if (!conversation) {
      return null;
    }

    const memberResult = await rawQuery<{
      createdAt: Date;
      lastReadAt: Date | null;
      lastReadSequence: number | null;
      leftAt: Date | null;
      mutedAt: Date | null;
      unreadCount: number | null;
    }>(
      messageSearchSql.reconcileMessageUnreadCounter.member,
      [input.conversationId, input.userId],
      {
        createdAt: "pg/timestamp-temporal@1",
        lastReadAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        lastReadSequence: { codecId: "pg/int4@1", nullable: true },
        leftAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        mutedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        unreadCount: { codecId: "pg/int4@1", nullable: true },
      },
      tx
    );
    const [member] = memberResult.rows;
    if (!member) {
      return null;
    }
    if (member.unreadCount !== null) {
      return member.unreadCount;
    }
    if (member.leftAt !== null || member.mutedAt !== null) {
      await rawExecute(
        messageSearchSql.reconcileMessageUnreadCounter
          .updateConversationMembers,
        [input.conversationId, input.userId],
        tx
      );

      return 0;
    }

    let membershipStart: Date | null = null;
    if (conversation.type === "DEN") {
      const joinedResult = await rawQuery<{ joinedAt: Date | null }>(
        messageSearchSql.reconcileMessageUnreadCounter.joined,
        [input.conversationId, input.userId],
        { joinedAt: { codecId: "pg/timestamp-temporal@1", nullable: true } },
        tx
      );
      const joinedAt = joinedResult.rows[0]?.joinedAt ?? null;
      membershipStart =
        joinedAt && joinedAt > member.createdAt ? joinedAt : member.createdAt;
    }

    const countResult = await rawQuery<{ count: string }>(
      messageSearchSql.reconcileMessageUnreadCounter.count,
      [
        input.conversationId,
        input.userId,
        member.lastReadAt ?? new Date(0),
        member.lastReadSequence,
        membershipStart,
      ],
      { count: "pg/text@1" },
      tx
    );
    const unreadCount = Number(countResult.rows[0]?.count ?? "0");
    if (
      !Number.isSafeInteger(unreadCount) ||
      unreadCount < 0 ||
      unreadCount > 2_147_483_647
    ) {
      throw new Error("Unread message count is outside the supported range");
    }

    const updated = await rawExecute(
      messageSearchSql.reconcileMessageUnreadCounter.updated,
      [input.conversationId, input.userId, unreadCount],
      tx
    );

    return updated.affectedRows === 1 ? unreadCount : null;
  });
}

export async function commitMessageSearchMutation(
  input: MessageSearchMutationInput
): Promise<MessageSearchMutationResult> {
  return await prisma.transaction(async (tx) => {
    const conversationLock = await rawQuery(
      messageSearchSql.commitMessageSearchMutation.conversationLock,
      [input.conversationId],
      { id: "pg/text@1" },
      tx
    );
    if (conversationLock.rows.length !== 1) {
      return { status: "not-found" };
    }
    await lockMessageSearchCoverageRow(tx, input.conversationId);
    const source = await rawQuery<{
      deletedAt: Date | null;
      revision: number;
      withinEditWindow: boolean;
    }>(
      messageSearchSql.commitMessageSearchMutation.source,
      [
        input.messageId,
        input.conversationId,
        input.senderId,
        input.kind === "upsert" ? input.editWindowStart : null,
      ],
      {
        deletedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        revision: "pg/int4@1",
        withinEditWindow: "pg/bool@1",
      },
      tx
    );
    const [message] = source.rows;
    if (!message) {
      return { status: "not-found" };
    }
    if (message.revision !== input.expectedRevision) {
      return { status: "revision-conflict" };
    }
    if (message.deletedAt) {
      return { status: "already-deleted" };
    }
    if (input.kind === "upsert" && !message.withinEditWindow) {
      return { status: "edit-expired" };
    }

    const update =
      input.kind === "delete"
        ? await rawQuery<{ revision: number }>(
            messageSearchSql.commitMessageSearchMutation.deleteMessage,
            [
              input.messageId,
              input.conversationId,
              input.expectedRevision,
              input.deletedAt,
            ],
            { revision: "pg/int4@1" },
            tx
          )
        : await rawQuery<{ revision: number }>(
            messageSearchSql.commitMessageSearchMutation.editMessage,
            [
              input.messageId,
              input.conversationId,
              input.expectedRevision,
              input.ciphertext,
              input.iv,
              input.editedAt,
            ],
            { revision: "pg/int4@1" },
            tx
          );
    const [updatedMessage] = update.rows;
    if (!updatedMessage) {
      throw new Error("Message revision changed while holding its row lock");
    }

    if (input.kind === "delete") {
      await rawExecute(
        messageSearchSql.commitMessageSearchMutation.updateConversationMembers,
        [input.conversationId],
        tx
      );
    }

    const sequenceResult = await rawQuery<{ changeSeq: number }>(
      messageSearchSql.commitMessageSearchMutation.sequence,
      [input.conversationId],
      { changeSeq: "pg/int4@1" },
      tx
    );
    const sequence = sequenceResult.rows[0]?.changeSeq;
    if (sequence === undefined) {
      throw new Error("Message conversation disappeared during mutation");
    }
    const audienceResult = await rawQuery<{ audienceUserIds: string[] }>(
      messageSearchSql.commitMessageSearchMutation.audience,
      [input.conversationId],
      { audienceUserIds: "pg/jsonb@1" },
      tx
    );
    const audienceUserIds = audienceResult.rows[0]?.audienceUserIds ?? [];
    const outboxId = randomUUID();
    await rawExecute(
      messageSearchSql.commitMessageSearchMutation.insertSearchOutbox,
      [
        outboxId,
        input.conversationId,
        input.messageId,
        updatedMessage.revision,
        sequence,
        input.kind,
        audienceUserIds,
      ],
      tx
    );
    await rawExecute(
      messageSearchSql.commitMessageSearchMutation.deleteSearchGaps,
      [input.conversationId, input.messageId, updatedMessage.revision],
      tx
    );
    await refreshUnreadableSearchCoverage(tx, input.conversationId);
    await rawExecute(
      messageSearchSql.commitMessageSearchMutation.insertConversationChanges,
      [
        randomUUID(),
        input.conversationId,
        sequence,
        input.messageId,
        updatedMessage.revision,
        input.kind === "delete"
          ? messageSearchSql.commitMessageSearchMutation.readPredicateFragment
          : messageSearchSql.commitMessageSearchMutation.readPredicateFragment2,
        audienceUserIds,
      ],
      tx
    );

    return {
      changeSequence: sequence,
      outboxId,
      revision: updatedMessage.revision,
      status: "updated",
    };
  });
}

export async function commitMessageConversationRead(input: {
  conversationId: string;
  membershipWindows: readonly SearchMessageWindow[];
  userId: string;
}): Promise<MessageReadCommitResult> {
  return await prisma.transaction(async (tx) => {
    // This lock serializes the read boundary with changeSeq writers while remaining compatible with message foreign-key KEY SHARE locks.
    const conversationResult = await rawQuery<{ changeSeq: number }>(
      messageSearchSql.commitMessageConversationRead.conversation,
      [input.conversationId],
      { changeSeq: "pg/int4@1" },
      tx
    );
    const [conversation] = conversationResult.rows;
    if (!conversation) {
      return { status: "conversation-not-found" };
    }

    const membershipResult = await rawQuery<{
      lastReadAt: Date | null;
      lastReadSequence: number | null;
      leftAt: Date | null;
      mutedAt: Date | null;
    }>(
      messageSearchSql.commitMessageConversationRead.membership,
      [input.conversationId, input.userId],
      {
        lastReadAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        lastReadSequence: { codecId: "pg/int4@1", nullable: true },
        leftAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        mutedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
      },
      tx
    );
    const [member] = membershipResult.rows;
    if (!member) {
      return { status: "membership-not-found" };
    }
    if (member.leftAt !== null) {
      return { status: "membership-ended" };
    }

    const values: unknown[] = [
      input.conversationId,
      input.userId,
      member.lastReadAt ?? new Date(0),
    ];
    let readPredicate =
      messageSearchSql.commitMessageConversationRead.readPredicateFragment;
    if (member.lastReadSequence !== null) {
      values.push(member.lastReadSequence);
      const sequenceParameter = `$${values.length}`;
      readPredicate = renderSql(
        messageSearchSql.commitMessageConversationRead.readPredicateFragment2,
        { sequenceParameter }
      );
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
          bounds.push(
            renderSql(
              messageSearchSql.commitMessageConversationRead.rangesFragment,
              { parameter1: values.length }
            )
          );
        }
        if (window.before !== null) {
          values.push(window.before);
          bounds.push(
            renderSql(
              messageSearchSql.commitMessageConversationRead.rangesFragment2,
              { parameter1: values.length }
            )
          );
        }
        return bounds.length === 0
          ? "TRUE"
          : renderSql(
              messageSearchSql.commitMessageConversationRead.rangesFragment3,
              { bounds: bounds.join(" AND ") }
            );
      });
      if (!ranges.includes("TRUE")) {
        membershipPredicate = renderSql(
          messageSearchSql.commitMessageConversationRead.readPredicateFragment3,
          { ranges: ranges.join(" OR ") }
        );
      }
    }

    const unreadResult = await rawQuery<{ count: string }>(
      renderSql(messageSearchSql.commitMessageConversationRead.unread, {
        membershipPredicate,
        readPredicate,
      }),
      values,
      { count: "pg/text@1" },
      tx
    );
    const countedUnread = Number(unreadResult.rows[0]?.count ?? "0");
    if (!Number.isSafeInteger(countedUnread) || countedUnread < 0) {
      throw new Error("Unread message count is outside the supported range");
    }

    const readSequence = conversation.changeSeq;
    const updatedMembership = await rawQuery<{ lastReadAt: Date }>(
      messageSearchSql.commitMessageConversationRead.updatedMembership,
      [input.conversationId, input.userId, readSequence],
      { lastReadAt: "pg/timestamp-temporal@1" },
      tx
    );
    const readAt = updatedMembership.rows[0]?.lastReadAt;
    if (!readAt) {
      throw new Error("Conversation membership disappeared while marking read");
    }

    return {
      readAt,
      readSequence,
      status: "read",
      unreadCount: member.mutedAt === null ? countedUnread : 0,
    };
  });
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

  return await prisma.transaction(async (tx) => {
    const conversation = await rawQuery<{ changeSeq: number }>(
      messageSearchSql.commitMessageHides.conversation,
      [input.conversationId],
      { changeSeq: "pg/int4@1" },
      tx
    );
    if (conversation.rows.length === 0) {
      return {
        changes: [],
        hidden: 0,
        status: "committed",
        unreadDecrement: 0,
      };
    }
    const membership = await rawQuery<{
      lastReadAt: Date | null;
      lastReadSequence: number | null;
      leftAt: Date | null;
      mutedAt: Date | null;
    }>(
      messageSearchSql.commitMessageHides.membership,
      [input.conversationId, input.userId],
      {
        lastReadAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        lastReadSequence: { codecId: "pg/int4@1", nullable: true },
        leftAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        mutedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
      },
      tx
    );
    const [member] = membership.rows;
    if (!member || member.leftAt) {
      return { status: "membership-ended" };
    }

    const source = await rawQuery<{
      creationSequence: number;
      createdAt: Date;
      deletedAt: Date | null;
      id: string;
      revision: number;
      senderId: string;
    }>(
      messageSearchSql.commitMessageHides.source,
      [input.conversationId, messageIds],
      {
        createdAt: "pg/timestamp-temporal@1",
        creationSequence: "pg/int4@1",
        deletedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        id: "pg/text@1",
        revision: "pg/int4@1",
        senderId: "pg/text@1",
      },
      tx
    );
    if (source.rows.length === 0) {
      return {
        changes: [],
        hidden: 0,
        status: "committed",
        unreadDecrement: 0,
      };
    }

    const inserted = await rawQuery<{ messageId: string }>(
      messageSearchSql.commitMessageHides.inserted,
      [input.conversationId, input.userId, source.rows.map((row) => row.id)],
      { messageId: "pg/text@1" },
      tx
    );
    const insertedIds = inserted.rows.map((row) => row.messageId).toSorted();
    if (insertedIds.length === 0) {
      return {
        changes: [],
        hidden: 0,
        status: "committed",
        unreadDecrement: 0,
      };
    }

    const bumped = await rawQuery<{ changeSeq: number }>(
      messageSearchSql.commitMessageHides.bumped,
      [input.conversationId, insertedIds.length],
      { changeSeq: "pg/int4@1" },
      tx
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
        kind: messageSearchSql.commitMessageHides.changesFragment,
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
      return renderSql(
        messageSearchSql.commitMessageHides.placeholdersFragment,
        {
          parameter1: offset + 1,
          parameter2: offset + 2,
          parameter3: offset + 3,
          parameter4: offset + 4,
          parameter5: offset + 5,
          parameter6: offset + 6,
          parameter7: offset + 7,
        }
      );
    });
    await rawExecute(
      renderSql(messageSearchSql.commitMessageHides.insertConversationChanges, {
        placeholders: placeholders.join(", "),
      }),
      values,
      tx
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
    await rawExecute(
      messageSearchSql.commitMessageHides.updateConversationMembers,
      [input.conversationId, input.userId],
      tx
    );

    return {
      changes,
      hidden: changes.length,
      status: "committed",
      unreadDecrement,
    };
  });
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
  const result = await rawQuery<MessageConversationChange>(
    messageSearchSql.listMessageConversationChanges.result,
    [
      input.conversationId,
      input.afterSequence,
      input.snapshotSequence,
      input.userId,
      JSON.stringify(windows),
      Math.min(Math.max(Math.trunc(input.limit), 1), 101),
    ],
    {
      audienceUserIds: "pg/jsonb@1",
      conversationId: "pg/text@1",
      createdAt: "pg/timestamp-temporal@1",
      globallyDeleted: "pg/bool@1",
      hiddenForViewer: "pg/bool@1",
      id: "pg/text@1",
      kind: "pg/text@1",
      messageId: { codecId: "pg/text@1", nullable: true },
      revision: { codecId: "pg/int4@1", nullable: true },
      sequence: "pg/int4@1",
      sourceAvailable: "pg/bool@1",
      sourceRevision: { codecId: "pg/int4@1", nullable: true },
    }
  );
  return result.rows;
}

export async function persistSearchDocument(
  artifact: SearchDocumentArtifact
): Promise<SearchArtifactCommitResult> {
  return await prisma.transaction(async (tx) => {
    await lockMessageSearchCoverageRow(tx, artifact.conversationId);
    const source = await rawQuery<{
      createdAt: Date;
      deletedAt: Date | null;
      revision: number;
    }>(
      messageSearchSql.persistSearchDocument.source,
      [artifact.messageId, artifact.conversationId],
      {
        createdAt: "pg/timestamp-temporal@1",
        deletedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        revision: "pg/int4@1",
      },
      tx
    );
    const [row] = source.rows;
    let status: SearchArtifactCommitResult["status"] = "superseded";

    if (row && !row.deletedAt && row.revision === artifact.revision) {
      await persistMessageSearchEpochProofs(
        tx,
        artifact.conversationId,
        artifact.epochProofs ?? []
      );
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
          return renderSql(
            messageSearchSql.persistSearchDocument.tuplesFragment,
            { parameter1: base + 1, parameter2: base + 2, parameter3: base + 3 }
          );
        });
        termInsertQueries.push({
          sql: renderSql(
            messageSearchSql.persistSearchDocument.insertSearchTerms,
            { tuples: tuples.join(",") }
          ),
          values,
        });
      }
      await Promise.all(
        termInsertQueries.map(({ sql, values }) => rawExecute(sql, values, tx))
      );

      const normalizedTerms = terms.map((term) => term.normalized);
      const termRows = normalizedTerms.length
        ? await rawQuery<{ id: number }>(
            messageSearchSql.persistSearchDocument.termRows,
            [artifact.conversationId, normalizedTerms],
            { id: "pg/int4@1" },
            tx
          )
        : { rows: [] as { id: number }[] };
      const termIds = [...new Set(termRows.rows.map((term) => term.id))];

      await rawExecute(
        messageSearchSql.persistSearchDocument.insertSearchDocuments,
        [
          artifact.messageId,
          artifact.conversationId,
          artifact.revision,
          row.createdAt,
          termIds,
        ],
        tx
      );
      await rawExecute(
        messageSearchSql.persistSearchDocument.deleteSearchReferences,
        [artifact.messageId, artifact.revision],
        tx
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
          return renderSql(
            messageSearchSql.persistSearchDocument.tuplesFragment2,
            {
              parameter1: base + 1,
              parameter2: base + 2,
              parameter3: base + 3,
              parameter4: base + 4,
              parameter5: base + 5,
              parameter6: base + 6,
              parameter7: base + 7,
              parameter8: base + 8,
            }
          );
        });
        await rawExecute(
          renderSql(
            messageSearchSql.persistSearchDocument.insertSearchReferences,
            { tuples: tuples.join(",") }
          ),
          values,
          tx
        );
      }
      await rawExecute(
        messageSearchSql.persistSearchDocument.updateMessages,
        [artifact.messageId, artifact.keyEpoch, artifact.revision],
        tx
      );
      await rawExecute(
        messageSearchSql.persistSearchDocument.deleteSearchGaps,
        [artifact.conversationId, artifact.messageId, artifact.revision],
        tx
      );
      await refreshUnreadableSearchCoverage(tx, artifact.conversationId);
      status = "indexed";
    } else {
      await rawExecute(
        messageSearchSql.persistSearchDocument.deleteSearchDocuments,
        [artifact.messageId, artifact.revision],
        tx
      );
      await rawExecute(
        messageSearchSql.persistSearchDocument.deleteSearchReferences2,
        [artifact.messageId, artifact.revision],
        tx
      );
      if (!row || row.deletedAt) {
        await rawExecute(
          messageSearchSql.persistSearchDocument.deleteSearchGaps2,
          [artifact.conversationId, artifact.messageId, artifact.revision],
          tx
        );
        await refreshUnreadableSearchCoverage(tx, artifact.conversationId);
      }
      if (!row || row.deletedAt) {
        await rawExecute(
          messageSearchSql.persistSearchDocument.deleteSearchTerms,
          [artifact.conversationId],
          tx
        );
      }
    }

    const outbox = await rawQuery<{
      changeSequence: number;
      conversationId: string;
    }>(
      messageSearchSql.persistSearchDocument.outbox,
      [artifact.outboxId, artifact.revision],
      { changeSequence: "pg/int4@1", conversationId: "pg/text@1" },
      tx
    );
    const [completed] = outbox.rows;
    if (completed) {
      const coverage = await rawQuery<{
        maxSequence: number | null;
        pendingSequence: number | null;
      }>(
        messageSearchSql.persistSearchDocument.coverage,
        [completed.conversationId],
        {
          maxSequence: { codecId: "pg/int4@1", nullable: true },
          pendingSequence: { codecId: "pg/int4@1", nullable: true },
        },
        tx
      );
      const [coverageRow] = coverage.rows;
      const settledSequence =
        coverageRow?.pendingSequence === null ||
        coverageRow?.pendingSequence === undefined
          ? (coverageRow?.maxSequence ?? 0)
          : Math.max(0, coverageRow.pendingSequence - 1);
      const updatedCoverage = await rawExecute(
        messageSearchSql.persistSearchDocument.updatedCoverage,
        [
          completed.conversationId,
          status === "indexed" ? 1 : 0,
          settledSequence,
        ],
        tx
      );
      if (updatedCoverage.affectedRows !== 1) {
        throw new Error("DM search coverage row disappeared during indexing");
      }
    }

    return { status };
  });
}

export async function listRunnableMessageSearchOutbox(input: {
  includeBackfill: boolean;
  limit: number;
  maxAttempts: number;
}): Promise<{ id: string; kind: string }[]> {
  const limit = Math.min(
    Math.max(Number.isFinite(input.limit) ? Math.trunc(input.limit) : 1, 1),
    100
  );
  const maxAttempts = Math.max(
    Number.isFinite(input.maxAttempts) ? Math.trunc(input.maxAttempts) : 1,
    1
  );
  const pending = prisma.orm.public.MessageSearchOutbox.select(
    "id",
    "kind"
  ).where((outbox) =>
    and(outbox.completedAt.isNull(), outbox.attempts.lt(maxAttempts))
  );
  const eligible = input.includeBackfill
    ? pending
    : pending.where((outbox) => outbox.kind.neq("backfill"));
  return await eligible
    .orderBy((outbox) => outbox.createdAt.asc())
    .limit(limit)
    .all();
}

export async function recordMessageSearchOutboxFailure(
  outboxId: string,
  maxAttempts: number
): Promise<number | null> {
  const cappedAttempts = Math.max(Math.trunc(maxAttempts), 1);

  const result = await rawQuery<{ attempts: number }>(
    messageSearchSql.recordMessageSearchOutboxFailure.result,
    [outboxId, cappedAttempts],
    { attempts: "pg/int4@1" }
  );
  return result.rows[0]?.attempts ?? null;
}

export async function startMessageSearchBackfill(
  conversationId: string
): Promise<{
  completedAt: Date | null;
  expectedPosition: MessageSearchBackfillPosition;
  throughSequence: number | null;
} | null> {
  await rawExecute(
    renderSql(
      messageSearchSql.startMessageSearchBackfill.insertSearchCoverage,
      { UNVERIFIED_CONVERSATION_EPOCH_SQL }
    ),
    [conversationId]
  );
  const result = await rawQuery<{
    backfillCompletedAt: Date | null;
    backfillCursorCreatedAt: Date | null;
    backfillCursorMessageId: string | null;
    backfillThroughSequence: number | null;
  }>(messageSearchSql.startMessageSearchBackfill.result, [conversationId], {
    backfillCompletedAt: {
      codecId: "pg/timestamp-temporal@1",
      nullable: true,
    },
    backfillCursorCreatedAt: {
      codecId: "pg/timestamp-temporal@1",
      nullable: true,
    },
    backfillCursorMessageId: { codecId: "pg/text@1", nullable: true },
    backfillThroughSequence: { codecId: "pg/int4@1", nullable: true },
  });
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
  const result = await rawQuery<{
    conversationId: string;
    backfillCursorMessageId: string | null;
  }>(
    messageSearchSql.listRunnableMessageSearchBackfills.result,
    [Math.min(Math.max(Math.trunc(limit), 1), 100)],
    {
      backfillCursorMessageId: { codecId: "pg/text@1", nullable: true },
      conversationId: "pg/text@1",
    }
  );
  return result.rows.map((row) => ({
    conversationId: row.conversationId,
    cursorMessageId: row.backfillCursorMessageId,
  }));
}

export async function readNextMessageSearchBackfillBatch(
  conversationId: string
): Promise<MessageSearchBackfillBatch | null> {
  const coverageResult = await rawQuery<{
    backfillCompletedAt: Date | null;
    backfillCursorCreatedAt: Date | null;
    backfillCursorMessageId: string | null;
    backfillThroughSequence: number | null;
  }>(
    messageSearchSql.readNextMessageSearchBackfillBatch.coverage,
    [conversationId],
    {
      backfillCompletedAt: {
        codecId: "pg/timestamp-temporal@1",
        nullable: true,
      },
      backfillCursorCreatedAt: {
        codecId: "pg/timestamp-temporal@1",
        nullable: true,
      },
      backfillCursorMessageId: { codecId: "pg/text@1", nullable: true },
      backfillThroughSequence: { codecId: "pg/int4@1", nullable: true },
    }
  );
  const [coverage] = coverageResult.rows;
  if (
    !coverage ||
    coverage.backfillCompletedAt ||
    coverage.backfillThroughSequence === null
  ) {
    return null;
  }

  const messagesResult = await rawQuery<MessageSearchBackfillMessage>(
    messageSearchSql.readNextMessageSearchBackfillBatch.messages,
    [
      conversationId,
      coverage.backfillThroughSequence,
      coverage.backfillCursorCreatedAt,
      coverage.backfillCursorMessageId,
      MESSAGE_SEARCH_BACKFILL_BATCH_MESSAGES,
      MESSAGE_SEARCH_BACKFILL_BATCH_BYTES,
    ],
    {
      ciphertext: "pg/text@1",
      createdAt: "pg/timestamp-temporal@1",
      deletedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
      id: "pg/text@1",
      iv: "pg/text@1",
      keyEpoch: { codecId: "pg/int4@1", nullable: true },
      ratchetIndex: "pg/int4@1",
      revision: "pg/int4@1",
      senderId: "pg/text@1",
    }
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
  epochProofs?: readonly MessageSearchEpochProof[];
  messageOutcomes: readonly MessageSearchBackfillOutcome[];
  conversationId: string;
  expectedPosition: MessageSearchBackfillPosition;
  finished: boolean;
  nextPosition: MessageSearchBackfillPosition;
  rowsTraversed: number;
  throughSequence: number;
}): Promise<{ committed: boolean }> {
  return await prisma.transaction(async (tx) => {
    const claimed = await rawQuery(
      messageSearchSql.commitMessageSearchBackfillBatch.claimed,
      [
        input.conversationId,
        input.throughSequence,
        input.nextPosition.createdAt,
        input.nextPosition.messageId,
        input.finished,
        input.expectedPosition.createdAt,
        input.expectedPosition.messageId,
      ],
      { conversationId: "pg/text@1" },
      tx
    );
    if (claimed.rows.length !== 1) {
      return { committed: false };
    }
    const messageIds = input.messageOutcomes.map(
      (message) => message.messageId
    );
    const sourceRows = messageIds.length
      ? await rawQuery<{
          deletedAt: Date | null;
          id: string;
          revision: number;
        }>(
          messageSearchSql.commitMessageSearchBackfillBatch.sourceRows,
          [input.conversationId, messageIds],
          {
            deletedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
            id: "pg/text@1",
            revision: "pg/int4@1",
          },
          tx
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
    const currentOutcomes = input.messageOutcomes.filter((outcome) => {
      const current = currentRevisions.get(outcome.messageId);
      return (
        current?.revision === outcome.revision &&
        (outcome.status === "deleted"
          ? current.deletedAt !== null
          : current.deletedAt === null)
      );
    });
    const currentArtifacts = input.artifacts.filter((artifact) => {
      const current = currentRevisions.get(artifact.messageId);
      return (
        current && !current.deletedAt && current.revision === artifact.revision
      );
    });
    await persistMessageSearchEpochProofs(tx, input.conversationId, [
      ...(input.epochProofs ?? []),
      ...currentArtifacts.flatMap((artifact) => artifact.epochProofs ?? []),
    ]);

    const resolvedMessageIds = currentOutcomes
      .filter((outcome) => outcome.status !== "unreadable")
      .map((outcome) => outcome.messageId);
    if (resolvedMessageIds.length > 0) {
      await rawExecute(
        messageSearchSql.commitMessageSearchBackfillBatch.deleteSearchGaps,
        [
          input.conversationId,
          resolvedMessageIds,
          currentOutcomes
            .filter((outcome) => outcome.status !== "unreadable")
            .map((outcome) => outcome.revision),
        ],
        tx
      );
    }
    const unreadableOutcomes = currentOutcomes.filter(
      (outcome) => outcome.status === "unreadable"
    );
    if (unreadableOutcomes.length > 0) {
      const gapValues: unknown[] = [];
      const gapTuples = unreadableOutcomes.map((outcome, index) => {
        const base = index * 5;
        gapValues.push(
          input.conversationId,
          outcome.messageId,
          outcome.revision,
          outcome.keyEpoch,
          outcome.unrecoverableEpoch
        );
        return renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch.gapTuplesFragment,
          {
            parameter1: base + 1,
            parameter2: base + 2,
            parameter3: base + 3,
            parameter4: base + 4,
            parameter5: base + 5,
          }
        );
      });
      await rawExecute(
        renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch.insertSearchGaps,
          { gapTuples: gapTuples.join(",") }
        ),
        gapValues,
        tx
      );
    }
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
        return renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch.tuplesFragment,
          { parameter1: base + 1, parameter2: base + 2, parameter3: base + 3 }
        );
      });
      termInsertQueries.push({
        sql: renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch.insertSearchTerms,
          { tuples: tuples.join(",") }
        ),
        values,
      });
    }
    await Promise.all(
      termInsertQueries.map(({ sql, values }) => rawExecute(sql, values, tx))
    );

    if (currentArtifacts.length > 0) {
      const normalizedTerms = terms.map((term) => term.normalized);
      const termRows = await rawQuery<{ id: number; normalized: string }>(
        messageSearchSql.commitMessageSearchBackfillBatch.termRows,
        [input.conversationId, normalizedTerms],
        { id: "pg/int4@1", normalized: "pg/text@1" },
        tx
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
        return renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch
            .documentTuplesFragment,
          {
            parameter1: base + 1,
            parameter2: base + 2,
            parameter3: base + 3,
            parameter4: base + 4,
            parameter5: base + 5,
          }
        );
      });
      await rawExecute(
        renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch
            .insertSearchDocuments,
          { documentTuples: documentTuples.join(",") }
        ),
        documentValues,
        tx
      );
      const references = currentArtifacts.flatMap((artifact) =>
        artifact.references.map((reference) => ({ artifact, reference }))
      );
      const currentMessageIds = currentArtifacts.map(
        (artifact) => artifact.messageId
      );
      if (currentMessageIds.length > 0) {
        await rawExecute(
          messageSearchSql.commitMessageSearchBackfillBatch
            .deleteSearchReferences,
          [input.conversationId, currentMessageIds],
          tx
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
            return renderSql(
              messageSearchSql.commitMessageSearchBackfillBatch
                .referenceTuplesFragment,
              {
                parameter1: base + 1,
                parameter2: base + 2,
                parameter3: base + 3,
                parameter4: base + 4,
                parameter5: base + 5,
                parameter6: base + 6,
                parameter7: base + 7,
                parameter8: base + 8,
              }
            );
          }
        );
        await rawExecute(
          renderSql(
            messageSearchSql.commitMessageSearchBackfillBatch
              .insertSearchReferences,
            { referenceTuples: referenceTuples.join(",") }
          ),
          referenceValues,
          tx
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
        return renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch.epochTuplesFragment,
          { parameter1: base + 1, parameter2: base + 2, parameter3: base + 3 }
        );
      });
      await rawExecute(
        renderSql(
          messageSearchSql.commitMessageSearchBackfillBatch.updateMessages,
          {
            conversationParameterIndex: epochValues.length + 1,
            epochTuples: epochTuples.join(","),
          }
        ),
        [...epochValues, input.conversationId],
        tx
      );
    }

    await refreshUnreadableSearchCoverage(tx, input.conversationId);
    await rawExecute(
      messageSearchSql.commitMessageSearchBackfillBatch.updateSearchCoverage,
      [
        input.conversationId,
        input.rowsTraversed,
        currentArtifacts.length,
        input.finished,
      ],
      tx
    );

    return { committed: true };
  });
}

export async function markSearchOutboxUnreadable(input: {
  changeSequence: number;
  conversationId: string;
  outboxId: string;
  revision: number;
  unrecoverableEpoch: number | null;
}): Promise<void> {
  return await prisma.transaction(async (tx) => {
    const pending = await rawQuery<{
      messageId: string;
      conversationId: string;
      changeSequence: number;
    }>(
      messageSearchSql.markSearchOutboxUnreadable.pending,
      [input.outboxId, input.revision],
      {
        changeSequence: "pg/int4@1",
        conversationId: "pg/text@1",
        messageId: "pg/text@1",
      },
      tx
    );
    const [outbox] = pending.rows;
    if (!outbox || outbox.conversationId !== input.conversationId) {
      return;
    }
    await lockMessageSearchCoverageRow(tx, input.conversationId);
    const source = await rawQuery<{
      deletedAt: Date | null;
      revision: number;
    }>(
      messageSearchSql.markSearchOutboxUnreadable.source,
      [outbox.messageId, input.conversationId],
      {
        deletedAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
        revision: "pg/int4@1",
      },
      tx
    );
    const [message] = source.rows;
    const completed = await rawQuery<{ conversationId: string }>(
      messageSearchSql.markSearchOutboxUnreadable.completed,
      [input.outboxId, input.revision],
      { conversationId: "pg/text@1" },
      tx
    );
    if (completed.rows[0]) {
      if (
        message &&
        !message.deletedAt &&
        message.revision === input.revision
      ) {
        await rawExecute(
          messageSearchSql.markSearchOutboxUnreadable.insertSearchGaps,
          [
            input.conversationId,
            outbox.messageId,
            input.revision,
            input.unrecoverableEpoch !== null,
          ],
          tx
        );
      } else if (!message || message.deletedAt) {
        await rawExecute(
          messageSearchSql.markSearchOutboxUnreadable.deleteSearchGaps,
          [input.conversationId, outbox.messageId, input.revision],
          tx
        );
      }
      const coverage = await rawQuery<{
        maxSequence: number | null;
        pendingSequence: number | null;
      }>(
        messageSearchSql.markSearchOutboxUnreadable.coverage,
        [input.conversationId],
        {
          maxSequence: { codecId: "pg/int4@1", nullable: true },
          pendingSequence: { codecId: "pg/int4@1", nullable: true },
        },
        tx
      );
      const [coverageRow] = coverage.rows;
      const settledSequence =
        coverageRow?.pendingSequence === null ||
        coverageRow?.pendingSequence === undefined
          ? (coverageRow?.maxSequence ?? 0)
          : Math.max(0, coverageRow.pendingSequence - 1);
      await refreshUnreadableSearchCoverage(tx, input.conversationId);
      const updatedCoverage = await rawExecute(
        messageSearchSql.markSearchOutboxUnreadable.updatedCoverage,
        [input.conversationId, settledSequence],
        tx
      );
      if (updatedCoverage.affectedRows !== 1) {
        throw new Error("DM search coverage row disappeared after indexing");
      }
    }
  });
}

const SEARCH_MESSAGE_CANDIDATES_SQL = (newer: boolean) =>
  renderSql(messageSearchSql.searchMessageCandidates.query, {
    cursorComparison: newer ? ">" : "<",
    readableEpochs: readableMessageKeyEpochsSql("$2"),
    sortDirection: newer ? "ASC" : "DESC",
  });

const SEARCH_MESSAGE_COUNT_SQL = renderSql(
  messageSearchSql.searchMessageCount.query,
  { readableEpochs: readableMessageKeyEpochsSql("$2") }
);

const SEARCH_ORDERED_DOCUMENT_PAGE_SQL = (newer: boolean) =>
  renderSql(messageSearchSql.searchOrderedDocumentPage.query, {
    cursorComparison: newer ? ">" : "<",
    readableEpochs: readableMessageKeyEpochsSql("$5"),
    sortDirection: newer ? "ASC" : "DESC",
    sortDirectionNext: newer ? "DESC" : "ASC",
  });

const SEARCH_ORDERED_CANDIDATE_HITS_SQL = (newer: boolean) =>
  renderSql(messageSearchSql.searchOrderedCandidateHits.query, {
    cursorComparison: newer ? ">" : "<",
    readableEpochs: readableMessageKeyEpochsSql("$2"),
    sortDirection: newer ? "ASC" : "DESC",
  });

const SEARCH_MESSAGE_CANDIDATES_SELECTIVE_SQL = (newer: boolean) =>
  renderSql(messageSearchSql.searchMessageCandidatesSelective.query, {
    cursorComparison: newer ? ">" : "<",
    readableEpochs: readableMessageKeyEpochsSql("$2"),
    sortDirection: newer ? "ASC" : "DESC",
  });

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
  if (input.before && input.after) {
    throw new TypeError("A message search page can use only one cursor");
  }
  const cursor = input.before ?? input.after;
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  return [
    input.conversationId,
    input.userId,
    JSON.stringify(input.fragments),
    input.snapshotSequence,
    cursor ? pgTimestamp(cursor.createdAt) : null,
    cursor?.messageId ?? null,
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
  const cursor = input.before ?? input.after;
  const { candidateMessageIds, indexedTermIds, strategy } = input;
  let sql = SEARCH_MESSAGE_CANDIDATES_SQL(input.after !== undefined);
  const parameters: SearchSqlParameter[] = [...queryParameters];
  if (strategy === "ordered") {
    sql = SEARCH_ORDERED_DOCUMENT_PAGE_SQL(input.after !== undefined);
    parameters.splice(
      0,
      parameters.length,
      input.conversationId,
      cursor ? pgTimestamp(cursor.createdAt) : null,
      cursor?.messageId ?? null,
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
    sql = SEARCH_ORDERED_CANDIDATE_HITS_SQL(input.after !== undefined);
    parameters.push([...candidateMessageIds]);
  } else if (indexedTermIds !== undefined) {
    sql = SEARCH_MESSAGE_CANDIDATES_SELECTIVE_SQL(input.after !== undefined);
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
  const result = await rawQuery<SearchCandidateExplainRow>(
    renderSql(
      messageSearchSql.explainSearchMessageCandidatesForDiagnostics.result,
      { sql }
    ),
    parameters,
    { "QUERY PLAN": "pg/jsonb@1" }
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
  const queryParameters = searchCandidateQueryParameters(input);

  return await prisma.transaction(async (tx) => {
    await rawExecute(
      messageSearchSql.searchMessageCandidates.isolation,
      [],
      tx
    );
    const frequency = await rawQuery<{
      candidateCount: string;
      fragmentOrdinal: number;
      termIds: number[];
    }>(
      messageSearchSql.fragmentFrequency.query,
      [queryParameters[0], queryParameters[2]],
      {
        candidateCount: "pg/text@1",
        fragmentOrdinal: "pg/int4@1",
        termIds: "pg/jsonb@1",
      },
      tx
    );
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
      return [];
    }
    const useSelectiveQuery =
      candidateCount <= BigInt(SEARCH_SELECTIVE_CANDIDATE_THRESHOLD);
    const useOrderedQuery =
      input.fragments.length === 1 && candidateCount >= 10_000n;
    if (useOrderedQuery) {
      const resultLimit = Math.min(Math.max(Math.trunc(input.limit), 1), 21);
      const results: SearchCandidateRow[] = [];
      let scanBefore = input.before ?? input.after;
      // oxlint-disable no-await-in-loop -- Continue from each document batch until the authorized hit page is full.
      while (results.length < resultLimit) {
        const scannedDocuments = await rawQuery<OrderedSearchDocumentRow>(
          SEARCH_ORDERED_DOCUMENT_PAGE_SQL(input.after !== undefined),
          [
            input.conversationId,
            scanBefore ? pgTimestamp(scanBefore.createdAt) : null,
            scanBefore?.messageId ?? null,
            ORDERED_SEARCH_SCAN_BATCH_SIZE,
            input.userId,
            input.snapshotSequence,
            queryParameters[6],
          ],
          {
            createdAt: { codecId: "pg/timestamp-temporal@1", nullable: true },
            messageId: { codecId: "pg/text@1", nullable: true },
            scannedCount: "pg/int4@1",
            scannedThroughCreatedAt: {
              codecId: "pg/timestamp-temporal@1",
              nullable: true,
            },
            scannedThroughMessageId: { codecId: "pg/text@1", nullable: true },
          },
          tx
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
          const candidates = await rawQuery<SearchCandidateRow>(
            SEARCH_ORDERED_CANDIDATE_HITS_SQL(input.after !== undefined),
            candidateParameters,
            {
              ciphertext: "pg/text@1",
              createdAt: "pg/timestamp-temporal@1",
              id: "pg/text@1",
              iv: "pg/text@1",
              keyEpoch: "pg/int4@1",
              ratchetIndex: "pg/int4@1",
              revision: "pg/int4@1",
              senderId: "pg/text@1",
            },
            tx
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

      return results;
    }
    const result = await rawQuery<SearchCandidateRow>(
      useSelectiveQuery
        ? SEARCH_MESSAGE_CANDIDATES_SELECTIVE_SQL(input.after !== undefined)
        : SEARCH_MESSAGE_CANDIDATES_SQL(input.after !== undefined),
      useSelectiveQuery
        ? [...queryParameters, selectiveFragment.termIds]
        : queryParameters,
      {
        ciphertext: "pg/text@1",
        createdAt: "pg/timestamp-temporal@1",
        id: "pg/text@1",
        iv: "pg/text@1",
        keyEpoch: "pg/int4@1",
        ratchetIndex: "pg/int4@1",
        revision: "pg/int4@1",
        senderId: "pg/text@1",
      },
      tx
    );

    return result.rows;
  });
}

export async function listMessageSearchReferences(
  input: SearchReferenceQuery
): Promise<SearchReferenceRow[]> {
  if (input.after && input.before) {
    throw new TypeError("A shared reference page can use only one cursor");
  }
  const cursor = input.before ?? input.after;
  const newer = input.before !== undefined;
  const cursorCondition = newer
    ? messageSearchSql.listMessageSearchReferences.cursorConditionFragment
    : messageSearchSql.listMessageSearchReferences.cursorConditionFragment2;
  const ordering = newer
    ? messageSearchSql.listMessageSearchReferences.orderingFragment
    : messageSearchSql.listMessageSearchReferences.orderingFragment2;
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));
  const result = await rawQuery<SearchReferenceRow>(
    renderSql(messageSearchSql.listMessageSearchReferences.result, {
      cursorCondition,
      ordering,
      readableEpochs: readableMessageKeyEpochsSql("$2"),
    }),
    [
      input.conversationId,
      input.userId,
      input.kind,
      input.snapshotSequence,
      cursor ? pgTimestamp(cursor.createdAt) : null,
      cursor?.messageId ?? null,
      cursor?.ordinal ?? null,
      JSON.stringify(windows),
      Math.min(Math.max(Math.trunc(input.limit), 1), 101),
    ],
    {
      createdAt: "pg/timestamp-temporal@1",
      keyEpoch: "pg/int4@1",
      mediaKind: { codecId: "pg/text@1", nullable: true },
      messageId: "pg/text@1",
      ordinal: "pg/int4@1",
      ratchetIndex: "pg/int4@1",
      requiredId: { codecId: "pg/text@1", nullable: true },
      revision: "pg/int4@1",
      senderId: "pg/text@1",
    }
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
  const result = await rawQuery<SearchCandidateRow>(
    renderSql(messageSearchSql.hydrateSearchMessageCandidates.result, {
      readableEpochs: readableMessageKeyEpochsSql("$2"),
    }),
    [
      input.conversationId,
      input.userId,
      JSON.stringify(requested),
      JSON.stringify(windows),
    ],
    {
      ciphertext: "pg/text@1",
      createdAt: "pg/timestamp-temporal@1",
      id: "pg/text@1",
      iv: "pg/text@1",
      keyEpoch: "pg/int4@1",
      ratchetIndex: "pg/int4@1",
      revision: "pg/int4@1",
      senderId: "pg/text@1",
    }
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
  if (input.fragments.length === 0) {
    return 0;
  }
  const windows = input.membershipWindows.map((window) => ({
    after: window.after ? pgTimestamp(window.after) : null,
    before: window.before ? pgTimestamp(window.before) : null,
  }));

  return await prisma.transaction(async (tx) => {
    await rawExecute(
      messageSearchSql.countMessageSearchCandidates.isolation,
      [],
      tx
    );
    await rawExecute(
      messageSearchSql.countMessageSearchCandidates.timeout,
      [],
      tx
    );
    const frequency = await rawQuery<{
      candidateCount: string;
      fragmentOrdinal: number;
      termIds: number[];
    }>(
      messageSearchSql.fragmentFrequency.query,
      [input.conversationId, JSON.stringify(input.fragments)],
      {
        candidateCount: "pg/text@1",
        fragmentOrdinal: "pg/int4@1",
        termIds: "pg/jsonb@1",
      },
      tx
    );
    const [selectiveFragment] = frequency.rows;
    if (!selectiveFragment) {
      throw new Error("Postgres did not return a DM search count estimate");
    }
    if (!Number.isSafeInteger(selectiveFragment.fragmentOrdinal)) {
      throw new TypeError(
        "Postgres returned an invalid DM search count fragment ordinal"
      );
    }
    if (!/^\d+$/u.test(selectiveFragment.candidateCount)) {
      throw new Error("Postgres returned an invalid DM search count estimate");
    }
    if (
      !Array.isArray(selectiveFragment.termIds) ||
      selectiveFragment.termIds.some(
        (termId) => !Number.isSafeInteger(termId) || termId < 1
      )
    ) {
      throw new Error("Postgres returned invalid DM search count term IDs");
    }
    if (BigInt(selectiveFragment.candidateCount) === 0n) {
      return 0;
    }
    if (selectiveFragment.termIds.length === 0) {
      throw new Error("Postgres returned no terms for a non-empty count");
    }
    const result = await rawQuery<{ count: string }>(
      SEARCH_MESSAGE_COUNT_SQL,
      [
        input.conversationId,
        input.userId,
        JSON.stringify(input.fragments),
        input.snapshotSequence,
        JSON.stringify(windows),
        selectiveFragment.termIds,
      ],
      { count: "pg/text@1" },
      tx
    );
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Search count is outside the supported integer range");
    }

    return count;
  });
}

export async function closeMessageSearchPool(): Promise<void> {
  // Compatibility hook: the shared client is closed by closePrisma().
}

export async function readMessageSearchViewerEpochCoverage(
  conversationId: string,
  userId: string
): Promise<{ pending: number; unavailable: number }> {
  const result = await rawQuery<{
    pending: number;
    unavailable: number;
  }>(MESSAGE_VIEWER_EPOCH_COVERAGE_SQL, [conversationId, userId], {
    pending: "pg/int4@1",
    unavailable: "pg/int4@1",
  });
  return result.rows[0] ?? { pending: 0, unavailable: 0 };
}

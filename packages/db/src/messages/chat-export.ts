import { randomBytes } from "node:crypto";

import { readerMessageWindows } from "@asm/messages";
import type { ReaderMessageWindow } from "@asm/messages";

import { fromPrismaDateTime, toPrismaDateTime } from "../dates";
import prisma from "../prisma";
import { listDenMembershipEvents } from "./dens/den-service";
import { rawQuery, rawExecute } from "./infrastructure/raw-sql";
import { ChatLifecycleError, lockChatLifecycle } from "./lifecycle";

export interface ChatExportStatus {
  id: string;
  status: string;
  expiresAt: string;
  errorCode: string | null;
}
export type ChatExportJob = NonNullable<
  Awaited<ReturnType<typeof prisma.orm.public.MessageExportJobs.first>>
>;

export function chatExportStatus(job: ChatExportJob): ChatExportStatus {
  return {
    errorCode: job.errorCode,
    expiresAt: fromPrismaDateTime(job.expiresAt).toISOString(),
    id: job.id,
    status: job.status,
  };
}

export function requestChatExport(
  conversationId: string,
  userId: string,
  options: { includeMedia: boolean; fromDate?: Date; toDate?: Date }
): Promise<ChatExportStatus> {
  return prisma.transaction(async (tx) => {
    const access = await lockChatLifecycle(conversationId, userId, tx);
    const existing = await tx.orm.public.MessageExportJobs.where({
      conversationId,
      userId,
    })
      .where((j) => j.status.in(["pending", "processing"]))
      .first();
    if (
      existing &&
      fromPrismaDateTime(existing.expiresAt).getTime() > Date.now()
    ) {
      return chatExportStatus(existing);
    }
    const state = await tx.orm.public.MessageSearchAccountState.where({
      userId,
    }).first();
    const conversation = await tx.orm.public.MessageConversations.where({
      id: conversationId,
    }).first();
    const job = await tx.orm.public.MessageExportJobs.create({
      clearedThroughSequence: access.clearedThroughSequence,
      conversationId,
      expiresAt: toPrismaDateTime(new Date(Date.now() + 60 * 60 * 1000)),
      fromDate: options.fromDate ? toPrismaDateTime(options.fromDate) : null,
      includeMedia: options.includeMedia,
      membershipSequence: conversation?.membershipSeq ?? 0,
      recoveryGeneration: state?.recoveryGeneration ?? 0,
      snapshotSequence: access.changeSeq,
      toDate: options.toDate ? toPrismaDateTime(options.toDate) : null,
      userId,
    });
    return chatExportStatus(job);
  });
}

export async function assertChatExportScope(
  id: string,
  userId: string,
  conversationId: string,
  attemptKey?: string
): Promise<ChatExportJob> {
  const job = await prisma.orm.public.MessageExportJobs.where({
    conversationId,
    id,
    userId,
  }).first();
  if (!job) {
    throw new ChatLifecycleError("EXPORT_NOT_FOUND", 404);
  }
  if (
    attemptKey &&
    (job.status !== "processing" || job.artifactKey !== attemptKey)
  ) {
    throw new ChatLifecycleError("EXPORT_LEASE_LOST", 409);
  }
  if (
    ["revoked", "cancelled"].includes(job.status) ||
    fromPrismaDateTime(job.expiresAt).getTime() <= Date.now()
  ) {
    throw new ChatLifecycleError("EXPORT_EXPIRED", 410);
  }
  const [member, conversation, recovery] = await Promise.all([
    prisma.orm.public.MessageConversationMembers.where({
      conversationId,
      userId,
    }).first(),
    prisma.orm.public.MessageConversations.where({
      id: conversationId,
    }).first(),
    prisma.orm.public.MessageSearchAccountState.where({ userId }).first(),
  ]);
  const { rows } = await rawQuery<{ changed: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public.message_conversation_changes
    WHERE "conversationId"=$1 AND sequence>$2::integer AND kind<>'message.created'
    AND (cardinality("audienceUserIds")=0 OR $3=ANY("audienceUserIds"))) AS changed`,
    [conversationId, job.snapshotSequence, userId],
    { changed: "pg/bool@1" }
  );
  if (
    !member ||
    !conversation ||
    member.clearedThroughSequence !== job.clearedThroughSequence ||
    conversation.membershipSeq !== job.membershipSequence ||
    (recovery?.recoveryGeneration ?? 0) !== job.recoveryGeneration ||
    rows[0]?.changed
  ) {
    await rawExecute(
      `UPDATE public.message_export_jobs SET status='revoked' WHERE id=$1`,
      [id]
    );
    throw new ChatLifecycleError("EXPORT_CHANGED", 409);
  }
  return job;
}

export async function chatExportWindows(
  job: ChatExportJob
): Promise<ReaderMessageWindow[]> {
  const conversation = await prisma.orm.public.MessageConversations.where({
    id: job.conversationId,
  }).first();
  const member = await prisma.orm.public.MessageConversationMembers.where({
    conversationId: job.conversationId,
    userId: job.userId,
  }).first();
  if (!conversation || !member) {
    throw new ChatLifecycleError("EXPORT_NOT_FOUND", 404);
  }
  const events =
    conversation._type === "DEN"
      ? await listDenMembershipEvents(
          job.conversationId,
          member.leftAt ? fromPrismaDateTime(member.leftAt) : null
        )
      : [];
  return readerMessageWindows({
    conversationType: conversation._type,
    events,
    membership: {
      createdAt: fromPrismaDateTime(member.createdAt),
      leftAt: member.leftAt ? fromPrismaDateTime(member.leftAt) : null,
    },
    userId: job.userId,
  });
}

export async function claimChatExport(
  jobId?: string
): Promise<ChatExportJob | null> {
  const { rows } = await rawQuery<{ id: string }>(
    `WITH candidate AS (SELECT id FROM public.message_export_jobs
    WHERE ($2::text IS NULL OR id=$2) AND (status='pending' OR (status='processing' AND "leaseUntil"<clock_timestamp())) AND "expiresAt">clock_timestamp()
    ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE public.message_export_jobs j SET status='processing',"leaseUntil"=clock_timestamp()+interval '5 minutes',"artifactKey"=$1
    FROM candidate c WHERE j.id=c.id RETURNING j.id`,
    [randomBytes(32).toString("base64"), jobId ?? null],
    { id: "pg/text@1" }
  );
  return rows[0]
    ? prisma.orm.public.MessageExportJobs.where({ id: rows[0].id }).first()
    : null;
}

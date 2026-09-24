import { setTimeout as sleep } from "node:timers/promises";

import { and } from "@prisma/orm-postgres/orm-client";

import { unreadNotificationCache } from "../../queue";
import prisma, { fromPrismaDateTime, toPrismaDateTime } from "../prisma";
import { SYSTEM_MODERATION_USER_ID } from "../users/reserved-usernames";

export interface CleanupPublishedNotificationsOptions {
  ageMs?: number;
  batchSize?: number;
  maxBatches?: number;
  batchDelayMs?: number;
  now?: Date;
}

export interface CleanupPublishedNotificationsResult {
  batchesProcessed: number;
  deletedCount: number;
}

export function cleanupExpiredPublishedNotifications(
  options: CleanupPublishedNotificationsOptions = {}
): Promise<CleanupPublishedNotificationsResult> {
  const ageMs = options.ageMs ?? 15 * 60 * 1000;
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? 50;
  const batchDelayMs = options.batchDelayMs ?? 0;
  const now = options.now ? options.now.getTime() : Date.now();
  const cutoff = new Date(now - ageMs);

  async function processBatch(
    batchesProcessed: number,
    totalDeleted: number
  ): Promise<CleanupPublishedNotificationsResult> {
    if (batchesProcessed >= maxBatches) {
      return { batchesProcessed, deletedCount: totalDeleted };
    }
    const batchResult = await prisma.transaction(async (transaction) => {
      const candidates = await transaction.orm.public.Notifications.select(
        "id",
        "read",
        "recipientId"
      )
        .where((notification) =>
          and(
            notification.createdAt.lte(toPrismaDateTime(cutoff)),
            notification.issuerId.eq(SYSTEM_MODERATION_USER_ID),
            notification._type.eq("PUBLISHED")
          )
        )
        .orderBy((notification) => notification.createdAt.asc())
        .limit(batchSize)
        .all();

      if (candidates.length === 0) {
        return { deleted: 0, unreadByRecipient: new Map<string, number>() };
      }

      const candidateIds = candidates.map((candidate) => candidate.id);
      const deleted = await transaction.orm.public.Notifications.where(
        (notification) =>
          and(
            notification.id.in(candidateIds),
            notification.issuerId.eq(SYSTEM_MODERATION_USER_ID),
            notification._type.eq("PUBLISHED")
          )
      ).deleteAndCount();

      const unreadByRecipient = new Map<string, number>();
      for (const candidate of candidates) {
        if (!candidate.read) {
          unreadByRecipient.set(
            candidate.recipientId,
            (unreadByRecipient.get(candidate.recipientId) ?? 0) + 1
          );
        }
      }

      return { deleted, unreadByRecipient };
    });

    if (batchResult.unreadByRecipient.size > 0) {
      await Promise.allSettled(
        [...batchResult.unreadByRecipient.entries()].map(
          ([recipientId, count]) =>
            unreadNotificationCache.decrement(recipientId, count)
        )
      );
    }

    const nextBatchesProcessed = batchesProcessed + 1;
    const nextTotalDeleted = totalDeleted + batchResult.deleted;
    if (batchResult.deleted < batchSize) {
      return {
        batchesProcessed: nextBatchesProcessed,
        deletedCount: nextTotalDeleted,
      };
    }
    if (batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }
    return processBatch(nextBatchesProcessed, nextTotalDeleted);
  }

  return processBatch(0, 0);
}

export interface CleanupSinglePublishedNotificationOptions {
  minAgeMs?: number;
  now?: Date;
}

export async function cleanupSinglePublishedNotification(
  notificationId: string,
  options: CleanupSinglePublishedNotificationOptions = {}
): Promise<boolean> {
  const minAgeMs = options.minAgeMs ?? 15 * 60 * 1000;
  const now = options.now ? options.now.getTime() : Date.now();
  const cutoff = new Date(now - minAgeMs);

  const result = await prisma.transaction(async (transaction) => {
    const notification = await transaction.orm.public.Notifications.select(
      "createdAt",
      "id",
      "issuerId",
      "read",
      "recipientId",
      "_type"
    )
      .where({ id: notificationId })
      .first();

    if (
      !notification ||
      notification.issuerId !== SYSTEM_MODERATION_USER_ID ||
      notification._type !== "PUBLISHED"
    ) {
      return { deleted: false, recipientId: null, wasUnread: false };
    }

    const createdAt = fromPrismaDateTime(notification.createdAt);
    if (createdAt.getTime() > cutoff.getTime() + 5000) {
      return { deleted: false, recipientId: null, wasUnread: false };
    }

    const deleted = await transaction.orm.public.Notifications.where(
      (candidate) =>
        and(
          candidate.id.eq(notificationId),
          candidate.issuerId.eq(SYSTEM_MODERATION_USER_ID),
          candidate._type.eq("PUBLISHED")
        )
    ).deleteAndCount();

    return {
      deleted: deleted > 0,
      recipientId: notification.recipientId,
      wasUnread: !notification.read,
    };
  });

  if (result.deleted && result.wasUnread && result.recipientId) {
    await unreadNotificationCache.decrement(result.recipientId);
  }

  return result.deleted;
}

import { setTimeout as sleep } from "node:timers/promises";

import { unreadNotificationCache } from "../../queue";
import prisma from "../prisma";
import { SYSTEM_MODERATION_USER_ID } from "../users/reserved-usernames";

export interface CleanupPublishedNotificationsOptions {
  // Age cutoff in milliseconds. Notifications older than this will be deleted.
  // Defaults to 15 minutes (15 * 60 * 1000).
  ageMs?: number;

  // Batch size per transaction. Keeps database locks brief and avoids
  // statement timeouts under high traffic.
  // Defaults to 100.
  batchSize?: number;

  // Maximum number of batches to process in a single invocation. Prevents
  // worker starvation when draining large production backlogs.
  // Defaults to 50 (i.e. up to 5,000 notifications per sweep).
  maxBatches?: number;

  // Milliseconds to yield between batches to keep DB contention low.
  // Defaults to 0.
  batchDelayMs?: number;

  // Reference timestamp for deterministic testing.
  // Defaults to Date.now().
  now?: Date;
}

export interface CleanupPublishedNotificationsResult {
  batchesProcessed: number;
  deletedCount: number;
}

// Sweeps and deletes Zeph's publish-confirmation notifications older than 15 minutes.
//
// Runs in batched transactions to support high-traffic production environments
// without locking large ranges of the notifications table or causing statement timeouts.
//
// Safety guarantees:
// - Targets ONLY notifications where issuerId is Zeph (SYSTEM_MODERATION_USER_ID)
//   and type is "PUBLISHED".
// - Never deletes MODERATION, TRANSCRIPTION, or user-issued notifications (LIKE, COMMENT, etc.).
// - Atomically decrements unreadNotificationCache for any recipients whose unread
//   notifications are purged.
export async function cleanupExpiredPublishedNotifications(
  options: CleanupPublishedNotificationsOptions = {}
): Promise<CleanupPublishedNotificationsResult> {
  const ageMs = options.ageMs ?? 15 * 60 * 1000;
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? 50;
  const batchDelayMs = options.batchDelayMs ?? 0;
  const now = options.now ? options.now.getTime() : Date.now();
  const cutoff = new Date(now - ageMs);

  let totalDeleted = 0;
  let batchesProcessed = 0;

  while (batchesProcessed < maxBatches) {
    // Each batch runs inside its own isolated transaction so locks are held for milliseconds only.
    // eslint-disable-next-line no-await-in-loop -- batched transaction sweep must await each batch
    const batchResult = await prisma.$transaction(async (tx) => {
      // Find candidate notifications matching Zeph's PUBLISHED notifications older than cutoff.
      const candidates = await tx.notification.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          read: true,
          recipientId: true,
        },
        take: batchSize,
        where: {
          createdAt: { lte: cutoff },
          issuerId: SYSTEM_MODERATION_USER_ID,
          type: "PUBLISHED",
        },
      });

      if (candidates.length === 0) {
        return { deleted: 0, unreadByRecipient: new Map<string, number>() };
      }

      const candidateIds = candidates.map((c) => c.id);

      // Defense-in-depth: repeat issuerId and type in the where clause to guarantee
      // that we NEVER delete any other user's notifications or any other notification type!
      const deleted = await tx.notification.deleteMany({
        where: {
          id: { in: candidateIds },
          issuerId: SYSTEM_MODERATION_USER_ID,
          type: "PUBLISHED",
        },
      });

      // Aggregate unread notifications per recipient to decrement Redis badge cache
      const unreadByRecipient = new Map<string, number>();
      for (const candidate of candidates) {
        if (!candidate.read) {
          unreadByRecipient.set(
            candidate.recipientId,
            (unreadByRecipient.get(candidate.recipientId) ?? 0) + 1
          );
        }
      }

      return { deleted: deleted.count, unreadByRecipient };
    });

    // Adjust unreadNotificationCache in Redis after transaction commit
    if (batchResult.unreadByRecipient.size > 0) {
      // eslint-disable-next-line no-await-in-loop -- unread cache update happens per committed batch
      await Promise.allSettled(
        [...batchResult.unreadByRecipient.entries()].map(
          ([recipientId, count]) =>
            unreadNotificationCache.decrement(recipientId, count)
        )
      );
    }

    totalDeleted += batchResult.deleted;
    batchesProcessed += 1;

    // Drained this cycle
    if (batchResult.deleted < batchSize) {
      break;
    }

    if (batchDelayMs > 0) {
      // eslint-disable-next-line no-await-in-loop -- throttler delay between consecutive transactions
      await sleep(batchDelayMs);
    }
  }

  return { batchesProcessed, deletedCount: totalDeleted };
}

export interface CleanupSinglePublishedNotificationOptions {
  // Minimum age in milliseconds before the notification may be deleted.
  // Defaults to 15 * 60 * 1000 (15 minutes).
  minAgeMs?: number;

  // Reference timestamp for deterministic testing.
  // Defaults to Date.now().
  now?: Date;
}

// Transactionally deletes a specific publish-confirmation notification if it is
// at least 15 minutes old, issued by Zeph, and of type "PUBLISHED".
export async function cleanupSinglePublishedNotification(
  notificationId: string,
  options: CleanupSinglePublishedNotificationOptions = {}
): Promise<boolean> {
  const minAgeMs = options.minAgeMs ?? 15 * 60 * 1000;
  const now = options.now ? options.now.getTime() : Date.now();
  const cutoff = new Date(now - minAgeMs);

  const result = await prisma.$transaction(async (tx) => {
    const notif = await tx.notification.findUnique({
      select: {
        createdAt: true,
        id: true,
        issuerId: true,
        read: true,
        recipientId: true,
        type: true,
      },
      where: { id: notificationId },
    });

    // Safety checks:
    // 1. Must exist
    // 2. Must be issued by Zeph (SYSTEM_MODERATION_USER_ID)
    // 3. Must be type "PUBLISHED"
    // 4. Must be at least minAgeMs old (allowing 5s clock skew leeway)
    if (
      !notif ||
      notif.issuerId !== SYSTEM_MODERATION_USER_ID ||
      notif.type !== "PUBLISHED"
    ) {
      return { deleted: false, recipientId: null, wasUnread: false };
    }

    if (notif.createdAt.getTime() > cutoff.getTime() + 5000) {
      return { deleted: false, recipientId: null, wasUnread: false };
    }

    const deleteResult = await tx.notification.deleteMany({
      where: {
        id: notificationId,
        issuerId: SYSTEM_MODERATION_USER_ID,
        type: "PUBLISHED",
      },
    });

    return {
      deleted: deleteResult.count > 0,
      recipientId: notif.recipientId,
      wasUnread: !notif.read,
    };
  });

  if (result.deleted && result.wasUnread && result.recipientId) {
    await unreadNotificationCache.decrement(result.recipientId);
  }

  return result.deleted;
}

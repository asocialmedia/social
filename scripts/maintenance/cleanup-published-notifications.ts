#!/usr/bin/env bun

import {
  and,
  cleanupExpiredPublishedNotifications,
  NotificationType,
  prisma,
  SYSTEM_MODERATION_USER_ID,
  toPrismaDateTime,
} from "@asm/db";

export function parseNumberFlag(
  argv: string[],
  prefix: string,
  defaultValue: number
): number {
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      const parsed = Number(arg.slice(prefix.length));
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }
  return defaultValue;
}

export interface CleanupCliOptions {
  ageMinutes: number;
  ageMs: number;
  batchDelayMs: number;
  batchSize: number;
  isDryRun: boolean;
  maxBatches: number;
}

export function parseCleanupArgs(argv: string[]): CleanupCliOptions {
  const isDryRun = argv.includes("--dry-run");
  const batchSize = parseNumberFlag(argv, "--batch-size=", 100);
  const maxBatches = parseNumberFlag(argv, "--max-batches=", 1000);
  const delayMs = parseNumberFlag(argv, "--delay-ms=", 20);
  const ageMinutes = parseNumberFlag(argv, "--age-minutes=", 15);
  const ageMs = ageMinutes * 60 * 1000;

  return {
    ageMinutes,
    ageMs,
    batchDelayMs: delayMs,
    batchSize,
    isDryRun,
    maxBatches,
  };
}

export interface RunCleanupCliDeps {
  cleanupFn?: typeof cleanupExpiredPublishedNotifications;
  countFn?: (args: {
    where: {
      createdAt: { lte: Date };
      issuerId: string;
      type: NotificationType;
    };
  }) => Promise<number>;
  logger?: Pick<typeof console, "log">;
}

export async function runCleanupCli(
  argv: string[] = process.argv.slice(2),
  deps: RunCleanupCliDeps = {}
) {
  const options = parseCleanupArgs(argv);
  const log = deps.logger?.log ?? console.log;
  const countFn =
    deps.countFn ??
    (async (args) => {
      const result = await prisma.orm.public.Notifications.where(
        (notification) =>
          and(
            notification.createdAt.lte(
              toPrismaDateTime(args.where.createdAt.lte)
            ),
            notification.issuerId.eq(SYSTEM_MODERATION_USER_ID),
            notification._type.eq(NotificationType.PUBLISHED)
          )
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
      return result.count;
    });
  const cleanupFn = deps.cleanupFn ?? cleanupExpiredPublishedNotifications;

  log("=== Zeph Published Notification Cleanup ===");
  log(`Cutoff age:   >= ${options.ageMinutes} minutes (${options.ageMs} ms)`);
  log(`Batch size:   ${options.batchSize}`);
  log(`Max batches:  ${options.maxBatches}`);
  log(`Batch delay:  ${options.batchDelayMs} ms`);
  log(`Dry run:      ${options.isDryRun ? "YES" : "NO"}`);
  log("===========================================\n");

  const cutoff = new Date(Date.now() - options.ageMs);

  if (options.isDryRun) {
    const count = await countFn({
      where: {
        createdAt: { lte: cutoff },
        issuerId: SYSTEM_MODERATION_USER_ID,
        type: NotificationType.PUBLISHED,
      },
    });
    log(`[DRY RUN] Found ${count} eligible Zeph publish notifications.`);
    return { count, dryRun: true };
  }

  const startTime = Date.now();
  const result = await cleanupFn({
    ageMs: options.ageMs,
    batchDelayMs: options.batchDelayMs,
    batchSize: options.batchSize,
    maxBatches: options.maxBatches,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  log("\n=== Cleanup Completed ===");
  log(`Deleted:           ${result.deletedCount} notifications`);
  log(`Batches processed: ${result.batchesProcessed}`);
  log(`Elapsed time:      ${elapsed}s`);
  log("=========================");

  return { dryRun: false, elapsed, result };
}

const isDirectExecution = Bun.argv.some(
  (arg) =>
    arg.endsWith("scripts/maintenance/cleanup-published-notifications.ts") ||
    arg.endsWith("cleanup-published-notifications.ts")
);

if (isDirectExecution) {
  runCleanupCli().catch((error: unknown) => {
    console.error("Cleanup failed:", error);
    process.exit(1);
  });
}

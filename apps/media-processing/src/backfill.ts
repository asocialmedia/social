// Backfill watchdog: converts pre-pipeline media (legacy rows with a storage
// key but no lifecycle) into the controlled pipeline, and garbage-collects
// legacy raw objects once derivatives fully supersede them.
//
// Two entry points:
//  - CLI: bun run src/backfill.ts [--limit N] [--dry-run] — one-shot conversion
//  - scheduled sweeps registered on the media queue so crashed/partial runs
//    self-heal forever
//
// Safety: live posts keep serving the legacy object until the scan publishes
// derivatives; the row flips atomically at READY. Nothing is deleted unless a
// derivative supersedes it and the retention window has passed.

import { prisma } from "@asm/db";
import { Worker } from "bullmq";

import { resolveWorkerMediaLimits, workerEnv } from "./env";
import { mediaLogger } from "./log";
import { getS3 } from "./s3";

const SWEEP_BATCH = Number(process.env.MEDIA_BACKFILL_BATCH ?? 50);
const GC_BATCH = Number(process.env.MEDIA_LEGACY_GC_BATCH ?? 200);

async function enqueueScanForLegacyRow(mediaId: string): Promise<void> {
  const { enqueueMediaScan } = await import("@asm/db");
  await enqueueMediaScan(mediaId, { backfill: true });
}

export async function backfillSweep(): Promise<{ enqueued: number }> {
  // Kill switch: MEDIA_BACKFILL_ENABLED=0 stops converting legacy rows
  // without redeploying (the scheduler stays registered but no-ops).
  if (!workerEnv.BACKFILL_ENABLED) {
    return { enqueued: 0 };
  }
  // Legacy rows: created before the pipeline, still UPLOADING with a real
  // object key and never rejected/deleted.
  const candidates = await prisma.media.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, key: true },
    take: SWEEP_BATCH,
    where: {
      key: { not: "" },
      pipelineVersion: null,
      status: "UPLOADING",
      url: { not: "" },
    },
  });

  let enqueued = 0;
  for (const candidate of candidates) {
    if (!candidate.key) {
      continue;
    }
    // Point the lifecycle at the existing object and re-run the full chain.
    const claimed = await prisma.media.updateMany({
      data: { originalKey: candidate.key, status: "QUARANTINED" },
      where: { id: candidate.id, pipelineVersion: null, status: "UPLOADING" },
    });
    if (claimed.count > 0) {
      try {
        await enqueueScanForLegacyRow(candidate.id);
        enqueued += 1;
      } catch (error) {
        console.error(`Backfill enqueue failed for ${candidate.id}:`, error);
        await prisma.media.updateMany({
          data: { originalKey: null, status: "UPLOADING" },
          where: { id: candidate.id },
        });
      }
    }
  }
  if (enqueued > 0) {
    mediaLogger.info({ count: enqueued }, "backfill sweep enqueued media");
  }
  return { enqueued };
}

export async function legacyGcSweep(): Promise<{ deletedObjects: number }> {
  // Opt-in destruction: MEDIA_LEGACY_GC_ENABLED must be set to "1" before
  // any object is deleted, and the retention window must be positive. This
  // keeps a fresh production deployment read-only until the migration has
  // been verified and retention is chosen deliberately.
  if (!workerEnv.LEGACY_GC_ENABLED) {
    return { deletedObjects: 0 };
  }
  const limits = resolveWorkerMediaLimits();
  if (limits.originalRetentionDays <= 0) {
    return { deletedObjects: 0 }; // Retention disabled: keep everything.
  }
  const cutoff = new Date(
    Date.now() - limits.originalRetentionDays * 24 * 60 * 60 * 1000
  );

  // READY rows whose derivatives supersede the legacy raw object, older than
  // the retention window.
  const rows = await prisma.media.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, key: true, publishedKey: true },
    take: GC_BATCH,
    where: {
      createdAt: { lt: cutoff },
      key: { not: "" },
      pipelineVersion: { not: null },
      publishedKey: { not: null },
      status: "READY",
    },
  });

  let deletedObjects = 0;
  const s3 = getS3();
  for (const row of rows) {
    if (!row.publishedKey || !row.key || row.key === row.publishedKey) {
      continue;
    }
    try {
      await s3.delete(row.key);
      deletedObjects += 1;
      await prisma.media.update({
        data: { key: "" }, // Legacy fallback retired; variants serve from here on.
        where: { id: row.id },
      });
    } catch (error) {
      console.error(`Legacy GC failed for ${row.id}:`, error);
    }
  }
  if (deletedObjects > 0) {
    mediaLogger.info({ deletedObjects }, "legacy GC removed raw objects");
  }
  return { deletedObjects };
}

// Retention sweep for pipeline originals. Published rows keep their exact
// uploaded bytes under quarantine/ for MEDIA_ORIGINAL_RETENTION_DAYS
// (forensics, re-processing, incident review); this sweep deletes the copies
// once the window passes and clears originalKey so swept rows never rescan.
// Guards baked into the query:
//   - pipelineVersion set: never touch legacy rows whose originalKey points
//     at live serving objects
//   - originalKey startsWith quarantine/: true quarantine copies only
//   - publishedKey set: verified bytes already promoted under media/
//   - processedAt older than the window: retention elapsed
// retention <= 0 disables the sweep entirely (scan deletes at publish).
export async function quarantineGcSweep(): Promise<{
  deletedObjects: number;
  reclaimedBytes: number;
}> {
  const limits = resolveWorkerMediaLimits();
  if (limits.originalRetentionDays <= 0) {
    return { deletedObjects: 0, reclaimedBytes: 0 };
  }
  const cutoff = new Date(
    Date.now() - limits.originalRetentionDays * 24 * 60 * 60 * 1000
  );

  const rows = await prisma.media.findMany({
    orderBy: { processedAt: "asc" },
    select: { id: true, originalKey: true, size: true },
    take: GC_BATCH,
    where: {
      OR: [
        {
          originalKey: { startsWith: "quarantine/" },
          pipelineVersion: { not: null },
          processedAt: { lt: cutoff },
          publishedKey: { not: null },
        },
        {
          // Only reap failed attachments past retention; orphaned FAILED
          // drafts are already covered by the abandoned-upload reaper.
          OR: [{ postId: { not: null } }, { commentId: { not: null } }],
          originalKey: { startsWith: "quarantine/" },
          pipelineVersion: { not: null },
          processedAt: { lt: cutoff },
          status: "FAILED",
        },
      ],
    },
  });

  let deletedObjects = 0;
  let reclaimedBytes = 0;
  const s3 = getS3();
  for (const row of rows) {
    if (!row.originalKey) {
      continue;
    }
    try {
      await s3.delete(row.originalKey);
      deletedObjects += 1;
      reclaimedBytes += row.size;
      await prisma.media.update({
        data: { originalKey: null },
        where: { id: row.id },
      });
    } catch (error) {
      // One failed delete must not strand the batch: skip and continue so
      // the next sweep retries this row after its window re-elapses.
      mediaLogger.warn(
        { error: String(error), mediaId: row.id },
        "quarantine GC delete failed"
      );
    }
  }
  if (deletedObjects > 0) {
    mediaLogger.info(
      {
        bytes: reclaimedBytes,
        count: deletedObjects,
        retentionDays: limits.originalRetentionDays,
      },
      "expired quarantine originals swept"
    );
  }
  return { deletedObjects, reclaimedBytes };
}

// Derived-heal sweep: rescans pipeline READY rows whose process stage never
// produced any derivatives. Every ready row spends some time in this state
// while its queued process job runs (images take seconds, HLS ladders
// minutes), so the candidate window starts well past normal processing:
// only rows published (processedAt) older than DERIVED_HEAL_GRACE_MS count as
// stranded. Covers the scan-stage enqueue failure the awaiting-scan contract
// defers here, BullMQ attempts exhausted, and worker crashes after publish.
// DOCUMENT uploads legitimately have no derivatives; only types known to
// generate them are healed.
export const DERIVED_HEAL_GRACE_MS = 60 * 60 * 1000;

const DERIVED_HEAL_TYPES = ["AUDIO", "IMAGE", "VIDEO"] as const;

export async function derivedHealSweep(): Promise<{ enqueued: number }> {
  if (!workerEnv.BACKFILL_ENABLED) {
    return { enqueued: 0 };
  }
  // The enqueue path is shared with the initial handoff, so duplicate jobs
  // collapse on jobId; the re-enqueue overwrites the completed one.
  const cutoff = new Date(Date.now() - DERIVED_HEAL_GRACE_MS);
  const candidates = await prisma.media.findMany({
    orderBy: { processedAt: "asc" },
    select: { id: true },
    take: SWEEP_BATCH,
    where: {
      createdAt: { lt: cutoff },
      failureCode: null,
      processedAt: { lt: cutoff, not: null },
      status: "READY",
      type: { in: [...DERIVED_HEAL_TYPES] },
    },
  });

  let enqueued = 0;
  for (const row of candidates) {
    const derivativeCount = await prisma.mediaDerivative.count({
      where: { mediaId: row.id },
    });
    if (derivativeCount > 0) {
      continue;
    }
    try {
      const { enqueueMediaProcess } = await import("@asm/db");
      await enqueueMediaProcess(row.id);
      enqueued += 1;
      mediaLogger.info({ mediaId: row.id }, "derived-heal swept stranded row");
    } catch (error) {
      console.error(`Derived-heal enqueue failed for ${row.id}:`, error);
    }
  }
  if (enqueued > 0) {
    mediaLogger.info(
      { count: enqueued },
      "derived-heal sweep re-enqueued processing"
    );
  }
  return { enqueued };
}

// Registers self-healing schedules on the media queue. Idempotent via
// upsertJobScheduler.
export async function registerBackfillSchedulers(connectionOptions: {
  maxRetriesPerRequest: null | number;
  url: string;
}): Promise<Worker> {
  const { Queue } = await import("bullmq");
  const queue = new Queue("media-sweeps", { connection: connectionOptions });
  const daily = 24 * 60 * 60 * 1000;
  await queue.upsertJobScheduler("media-backfill-sweep", { every: daily });
  await queue.upsertJobScheduler("media-legacy-gc", { every: daily });
  await queue.upsertJobScheduler("media-quarantine-gc", { every: daily });
  await queue.upsertJobScheduler("media-derived-heal", { every: daily });
  return new Worker(
    "media-sweeps",
    async (job) => {
      switch (job.name) {
        case "media-backfill-sweep": {
          return await backfillSweep();
        }
        case "media-legacy-gc": {
          return await legacyGcSweep();
        }
        case "media-quarantine-gc": {
          return await quarantineGcSweep();
        }
        case "media-derived-heal": {
          return await derivedHealSweep();
        }
        default: {
          throw new Error(`Unknown sweep job: ${job.name}`);
        }
      }
    },
    {
      concurrency: 1,
      connection: connectionOptions as unknown as never,
    }
  );
}

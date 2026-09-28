// Backfill watchdog: converts pre-pipeline media (legacy rows with a storage
// key but no lifecycle) into the controlled pipeline, and garbage-collects
// legacy raw objects once derivatives fully supersede them.
//
// Two entry points:
//  - CLI: bun run src/sweeps [--limit N] [--dry-run] — one-shot conversion
//  - scheduled sweeps registered on the media queue so crashed/partial runs
//    self-heal forever
//
// Safety: live posts keep serving the legacy object until the scan publishes
// derivatives; the row flips atomically at READY. Nothing is deleted unless a
// derivative supersedes it and the retention window has passed.

import {
  and,
  enqueueMediaAnalyze,
  enqueueMediaProcess,
  enqueueMediaScan,
  prisma,
  toPrismaDateTime,
} from "@asm/db";
import { MEDIA_PIPELINE_VERSION } from "@asm/media";
import { Worker } from "bullmq";

import { SEMANTIC_CLASSIFICATION_VERSION } from "../analyze/semantic-version";
import { resolveWorkerMediaLimits, workerEnv } from "../env";
import { mediaLogger } from "../log";
import { getS3 } from "../s3";

const SWEEP_BATCH = Number(process.env.MEDIA_BACKFILL_BATCH ?? 50);
const GC_BATCH = Number(process.env.MEDIA_LEGACY_GC_BATCH ?? 200);

async function enqueueScanForLegacyRow(mediaId: string): Promise<void> {
  await enqueueMediaScan(mediaId, { backfill: true });
}

export async function legacyMigrationSweep(): Promise<{ enqueued: number }> {
  // Kill switch: MEDIA_BACKFILL_ENABLED=0 stops converting legacy rows
  // without redeploying (the scheduler stays registered but no-ops).
  if (!workerEnv.BACKFILL_ENABLED) {
    return { enqueued: 0 };
  }
  // Legacy rows: created before the pipeline, still UPLOADING with a real
  // object key and never rejected/deleted.
  const candidates = await prisma.orm.public.PostMedia.select("id", "key")
    .where((media) =>
      and(
        media.key.neq(""),
        media.pipelineVersion.isNull(),
        media.status.eq("UPLOADING"),
        media.url.neq("")
      )
    )
    .orderBy((media) => media.createdAt.asc())
    .limit(SWEEP_BATCH)
    .all();

  let enqueued = 0;
  for (const candidate of candidates) {
    if (!candidate.key) {
      continue;
    }
    // Point the lifecycle at the existing object and re-run the full chain.
    const claimed = await prisma.orm.public.PostMedia.where((media) =>
      and(
        media.id.eq(candidate.id),
        media.pipelineVersion.isNull(),
        media.status.eq("UPLOADING")
      )
    ).updateAndCount({ originalKey: candidate.key, status: "QUARANTINED" });
    if (claimed > 0) {
      try {
        await enqueueScanForLegacyRow(candidate.id);
        enqueued += 1;
      } catch (error) {
        console.error(
          `Legacy migration enqueue failed for ${candidate.id}:`,
          error
        );
        await prisma.orm.public.PostMedia.where({ id: candidate.id }).update({
          originalKey: null,
          status: "UPLOADING",
        });
      }
    }
  }
  if (enqueued > 0) {
    mediaLogger.info(
      { count: enqueued },
      "legacy migration sweep enqueued media"
    );
  }
  return { enqueued };
}

export const backfillSweep = legacyMigrationSweep;

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
  const rows = await prisma.orm.public.PostMedia.select(
    "id",
    "key",
    "publishedKey"
  )
    .where((media) =>
      and(
        media.createdAt.lt(toPrismaDateTime(cutoff)),
        media.key.neq(""),
        media.pipelineVersion.isNotNull(),
        media.publishedKey.isNotNull(),
        media.status.eq("READY")
      )
    )
    .orderBy((media) => media.createdAt.asc())
    .limit(GC_BATCH)
    .all();

  let deletedObjects = 0;
  const s3 = getS3();
  for (const row of rows) {
    if (!row.publishedKey || !row.key || row.key === row.publishedKey) {
      continue;
    }
    try {
      await s3.delete(row.key);
      deletedObjects += 1;
      await prisma.orm.public.PostMedia.where({ id: row.id }).update({
        key: "",
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

  const cutoffTemporal = toPrismaDateTime(cutoff);
  const [publishedRows, failedPostRows, failedCommentRows] = await Promise.all([
    prisma.orm.public.PostMedia.select("id", "originalKey", "size")
      .where((media) =>
        and(
          media.originalKey.like("quarantine/%"),
          media.pipelineVersion.isNotNull(),
          media.processedAt.lt(cutoffTemporal),
          media.publishedKey.isNotNull()
        )
      )
      .orderBy((media) => media.processedAt.asc())
      .limit(GC_BATCH)
      .all(),
    prisma.orm.public.PostMedia.select("id", "originalKey", "size")
      .where((media) =>
        and(
          media.originalKey.like("quarantine/%"),
          media.pipelineVersion.isNotNull(),
          media.processedAt.lt(cutoffTemporal),
          media.status.eq("FAILED"),
          media.postId.isNotNull()
        )
      )
      .orderBy((media) => media.processedAt.asc())
      .limit(GC_BATCH)
      .all(),
    prisma.orm.public.PostMedia.select("id", "originalKey", "size")
      .where((media) =>
        and(
          media.originalKey.like("quarantine/%"),
          media.pipelineVersion.isNotNull(),
          media.processedAt.lt(cutoffTemporal),
          media.status.eq("FAILED"),
          media.commentId.isNotNull()
        )
      )
      .orderBy((media) => media.processedAt.asc())
      .limit(GC_BATCH)
      .all(),
  ]);
  const rows = [
    ...new Map(
      [...publishedRows, ...failedPostRows, ...failedCommentRows].map((row) => [
        row.id,
        row,
      ])
    ).values(),
  ].slice(0, GC_BATCH);

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
      await prisma.orm.public.PostMedia.where({ id: row.id }).update({
        originalKey: null,
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

// Derived-heal sweep: rescans pipeline rows whose processing never completed.
// Two stranded shapes are covered:
//  1. READY rows whose process stage never produced any derivatives. Every
//     ready row spends some time in this state while its queued process job
//     runs (images take seconds, HLS ladders minutes), so the candidate
//     window starts well past normal processing: only rows published
//     (processedAt) older than DERIVED_HEAL_GRACE_MS count as stranded.
//  2. QUARANTINED/SCANNING rows whose scan job never ran (e.g. enqueued
//     while the worker was down, then swallowed by a stale jobId). These
//     still hold unscanned bytes under quarantine/, so they are re-enqueued
//     for a fresh scan with a dedupe-busting jobId suffix.
// Covers the scan-stage enqueue failure the awaiting-scan contract defers
// here, BullMQ attempts exhausted, and worker crashes mid-flight.
// DOCUMENT uploads legitimately have no derivatives; only types known to
// generate them are healed.
export const DERIVED_HEAL_GRACE_MS = 60 * 60 * 1000;

const DERIVED_HEAL_TYPES = ["AUDIO", "IMAGE", "VIDEO"] as const;

export async function derivedHealSweep(): Promise<{ enqueued: number }> {
  if (!workerEnv.BACKFILL_ENABLED) {
    return { enqueued: 0 };
  }
  // The enqueue path is shared with the initial handoff, so duplicate jobs
  // collapse on jobId; addWithFreshId clears completed/failed jobs holding
  // the id so the re-enqueue actually lands.
  const cutoff = new Date(Date.now() - DERIVED_HEAL_GRACE_MS);
  const cutoffTemporal = toPrismaDateTime(cutoff);
  const candidates = await prisma.orm.public.PostMedia.select("id")
    .where((media) =>
      and(
        media.createdAt.lt(cutoffTemporal),
        media.failureCode.isNull(),
        media.processedAt.lt(cutoffTemporal),
        media.status.eq("READY"),
        media._type.in([...DERIVED_HEAL_TYPES])
      )
    )
    .orderBy((media) => media.processedAt.asc())
    .limit(SWEEP_BATCH)
    .all();

  let enqueued = 0;
  for (const row of candidates) {
    const { count: derivativeCount } =
      await prisma.orm.public.PostMediaDerivatives.where({
        mediaId: row.id,
      }).aggregate((aggregate) => ({ count: aggregate.count() }));
    if (derivativeCount > 0) {
      continue;
    }
    try {
      await enqueueMediaProcess(row.id);
      enqueued += 1;
      mediaLogger.info({ mediaId: row.id }, "derived-heal swept stranded row");
    } catch (error) {
      console.error(`Derived-heal enqueue failed for ${row.id}:`, error);
    }
  }

  // Unscanned quarantine stragglers: rows parked in QUARANTINED for over a
  // grace period whose bytes are still under quarantine/. The strict age
  // window keeps rows mid-scan (or racing a just-restarted worker) out, and
  // SCANNING is excluded because processMediaScan only claims QUARANTINED
  // rows - a stuck SCANNING row is recovered when its worker restarts and
  // the claim flips it back through the pipeline.
  const unscanned = await prisma.orm.public.PostMedia.select("id")
    .where((media) =>
      and(
        media.createdAt.lt(cutoffTemporal),
        media.originalKey.like("quarantine/%"),
        media.pipelineVersion.isNull(),
        media.status.eq("QUARANTINED"),
        media._type.in([...DERIVED_HEAL_TYPES])
      )
    )
    .orderBy((media) => media.createdAt.asc())
    .limit(SWEEP_BATCH)
    .all();
  for (const row of unscanned) {
    try {
      // Suffix busts any dead jobId occupying the dedupe slot.
      await enqueueMediaScan(row.id, { jobIdSuffix: `heal-${Date.now()}` });
      enqueued += 1;
      mediaLogger.info(
        { mediaId: row.id },
        "derived-heal re-enqueued unscanned quarantine row"
      );
    } catch (error) {
      console.error(`Derived-heal scan enqueue failed for ${row.id}:`, error);
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

export const STORAGE_INTEGRITY_GRACE_MS = 60 * 60 * 1000; // 1 hour
// Read per run, not at import, so the batch size is tunable per pass and the
// round-robin wrap can be exercised in tests.
function storageIntegrityBatch(): number {
  return Number(process.env.MEDIA_INTEGRITY_BATCH ?? 50);
}
// Round-robin cursor: a first-N-by-age verifier would re-check the same
// healthy rows forever and never reach the rest of the corpus. In-memory is
// enough - the worker is one process, and a second replica would just cover
// its own slice of the same order.
let integrityCursor: null | string = null;

// Storage integrity: catches READY rows whose bytes have gone missing from
// storage. derivedHealSweep only rescues rows with zero derivative ROWS, so a
// row whose rows exist while the objects behind them are gone - the crash
// between publish and upload, a restored bucket, storage that lost a prefix -
// is invisible to it and stays broken until a viewer hits a failed read.
//
// The repair is a single enqueue: processMedia writes every derivative object
// to S3 BEFORE persisting its row, and persistMediaDerivatives only skips the
// redundant row insert, so a re-run re-uploads the bytes that vanished.
// A missing SOURCE is the one thing nothing can regenerate, so the row is
// retired with a failureCode instead - the feed then shows a placeholder
// rather than a player that can never load.
export async function storageIntegritySweep(): Promise<{
  checked: number;
  healed: number;
  retired: number;
}> {
  if (!workerEnv.BACKFILL_ENABLED) {
    return { checked: 0, healed: 0, retired: 0 };
  }
  const cutoff = toPrismaDateTime(
    new Date(Date.now() - STORAGE_INTEGRITY_GRACE_MS)
  );
  const candidates = await prisma.orm.public.PostMedia.select(
    "id",
    "customThumbnailKey",
    "key",
    "originalKey",
    "publishedKey",
    "thumbnailKey"
  )
    .where((media) =>
      and(
        ...(integrityCursor ? [media.id.gt(integrityCursor)] : []),
        media.status.eq("READY"),
        media.failureCode.isNull(),
        media.createdAt.lt(cutoff),
        media._type.in([...DERIVED_HEAL_TYPES])
      )
    )
    .orderBy((media) => media.id.asc())
    .limit(storageIntegrityBatch())
    .all();

  let checked = 0;
  let healed = 0;
  let retired = 0;
  for (const row of candidates) {
    const sourceKey = row.publishedKey || row.originalKey || row.key || "";
    if (!sourceKey) {
      continue;
    }
    try {
      // A missing SOURCE is the one thing nothing can regenerate, so the row is
      // retired and the feed falls back to a placeholder rather than a player
      // that can never load. It is also the one destructive action here, so it
      // needs two definitive NoSuchKey answers: an unreadable storage is
      // "unknown", not data loss, and must leave the row untouched.
      const sourceProbe = await probeObject(sourceKey);
      if (sourceProbe === "unknown") {
        console.error(
          `Storage-integrity could not read ${sourceKey} for ${row.id}; leaving it for the next pass`
        );
        continue;
      }
      if (sourceProbe === "absent" && (await confirmMissing(sourceKey))) {
        await prisma.orm.public.PostMedia.where({ id: row.id }).update({
          failureCode: "storage-missing",
          failureDetail: {
            detail:
              "source object missing from storage; nothing can regenerate it",
            key: sourceKey,
          },
          status: "FAILED",
        });
        retired += 1;
        mediaLogger.warn(
          { key: sourceKey, mediaId: row.id },
          "storage-integrity retired row with no source bytes"
        );
        continue;
      }

      const derivatives = await prisma.orm.public.PostMediaDerivatives.select(
        "key",
        "kind",
        "pipelineVersion",
        "variant"
      )
        .where({ mediaId: row.id })
        .all();
      const missing: string[] = [];
      // A missing object from an OLD pipeline version can never be repaired:
      // the process job writes version-stamped keys and never revisits the
      // retired ones. Re-enqueueing on those would re-run the whole transcode
      // every cycle and never clear the report, so only current-version
      // breakage triggers a heal.
      const repairable: string[] = [];
      const probed = new Set<string>();
      let undeterminable = false;
      for (const derivative of derivatives) {
        if (probed.has(derivative.key)) {
          continue;
        }
        probed.add(derivative.key);
        const probe = await probeObject(derivative.key);
        if (probe === "unknown") {
          undeterminable = true;
          continue;
        }
        if (probe === "present") {
          continue;
        }
        missing.push(`${derivative.kind}/${derivative.variant}`);
        if (derivative.pipelineVersion === MEDIA_PIPELINE_VERSION) {
          repairable.push(derivative.key);
        }
      }
      // The thumbnail columns are served directly by the read route, so a
      // lost object there 404s every feed card for this post even when the
      // derivative rows are all intact. thumbnailKey is written from the
      // current version's poster key, so a miss here is always repairable.
      for (const thumbKey of [row.thumbnailKey, row.customThumbnailKey]) {
        if (!thumbKey || probed.has(thumbKey)) {
          continue;
        }
        probed.add(thumbKey);
        const probe = await probeObject(thumbKey);
        if (probe === "unknown") {
          undeterminable = true;
          continue;
        }
        if (probe === "absent") {
          missing.push(`thumb:${thumbKey}`);
          repairable.push(thumbKey);
        }
      }

      // A row with an unreadable object is not a verified row: counting it
      // would report storage as healthy while objects stay unproven.
      if (undeterminable) {
        continue;
      }
      checked += 1;
      if (missing.length > 0) {
        mediaLogger.warn(
          { mediaId: row.id, missing },
          "storage-integrity found missing objects"
        );
      }
      if (repairable.length > 0) {
        await enqueueMediaProcess(row.id, {
          jobIdSuffix: `integrity-${Date.now()}`,
        });
        healed += 1;
        mediaLogger.warn(
          { mediaId: row.id, repairable },
          "storage-integrity re-enqueued row with missing derivatives"
        );
      }
    } catch (error) {
      // One unreachable object or one refused enqueue must not strand the rest
      // of the batch; the cursor still advances so the row is re-checked next
      // cycle.
      console.error(`Storage-integrity check failed for ${row.id}:`, error);
    }
  }

  const last = candidates.at(-1);
  // Running off the end wraps back to the start, so a small corpus is simply
  // re-verified each cycle.
  integrityCursor =
    candidates.length < storageIntegrityBatch() ? null : (last?.id ?? null);

  if (checked > 0 || retired > 0) {
    mediaLogger.info(
      { checked, healed, retired },
      "storage-integrity sweep verified READY media"
    );
  }
  return { checked, healed, retired };
}

// A HEAD-only existence probe. Never downloads bytes, so verifying a row costs
// one request per object and nothing else.
//
// The third state is the point. rustfs answers a genuinely missing key with
// NoSuchKey, but a refused connection or a 5xx is ALSO an S3Error, so a
// catch-all that read every failure as "absent" would let one storage blip
// retire a whole batch of perfectly healthy media as FAILED. Only a
// definitive NoSuchKey is proof of data loss; anything else is "unknown",
// which never mutates a row.
type ObjectProbe = "absent" | "present" | "unknown";

async function probeObject(key: string): Promise<ObjectProbe> {
  try {
    await getS3().file(key).stat();
    return "present";
  } catch (error) {
    const {code} = (error as { code?: string });
    return code === "NoSuchKey" || code === "NotFound" ? "absent" : "unknown";
  }
}

// A second probe before the one destructive action in this sweep. objectExists
// in ../s3 collapses every failure to "not there", which is fine for a
// liveness check but must never gate a permanent state change on its own.
async function confirmMissing(key: string): Promise<boolean> {
  if ((await probeObject(key)) !== "absent") {
    return false;
  }
  await Bun.sleep(500);
  return (await probeObject(key)) === "absent";
}

export const MAX_TRANSCRIPTION_BACKFILL_ATTEMPTS = 3;
export const TRANSCRIPTION_BACKFILL_RETRY_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// Transcription backfill sweep: finds READY audio and video rows that do not
// have captions or a transcript yet (e.g. uploaded before GEMINI_API_KEY was
// set or when transcription was temporarily offline), and re-enqueues them for
// semantic analysis & transcription. Bounded by max attempts and retry windows
// so uncaptionable/failed rows do not loop endlessly.
export async function transcriptionBackfillSweep(): Promise<{
  enqueued: number;
}> {
  if (!workerEnv.BACKFILL_ENABLED) {
    return { enqueued: 0 };
  }
  const candidates = await prisma.orm.public.PostMedia.select(
    "id",
    "techMetadata"
  )
    .where((media) =>
      and(
        media.captionsKey.isNull(),
        media.status.eq("READY"),
        media._type.in(["VIDEO", "AUDIO"])
      )
    )
    .orderBy((media) => media.createdAt.desc())
    .limit(SWEEP_BATCH)
    .all();

  let enqueued = 0;
  const now = Date.now();
  for (const candidate of candidates) {
    const tech =
      candidate.techMetadata && typeof candidate.techMetadata === "object"
        ? (candidate.techMetadata as Record<string, unknown>)
        : null;
    const trans =
      tech?.transcription && typeof tech.transcription === "object"
        ? (tech.transcription as Record<string, unknown>)
        : null;

    if (trans) {
      const status = typeof trans.status === "string" ? trans.status : "";
      // Definitively uncaptionable media - never retry
      if (
        status === "no_audio" ||
        status === "silent" ||
        status === "completed"
      ) {
        continue;
      }
      const attempts = typeof trans.attempts === "number" ? trans.attempts : 1;
      if (attempts >= MAX_TRANSCRIPTION_BACKFILL_ATTEMPTS) {
        continue;
      }
      const lastAttempt =
        typeof trans.attemptedAt === "string"
          ? new Date(trans.attemptedAt).getTime()
          : 0;
      if (now - lastAttempt < TRANSCRIPTION_BACKFILL_RETRY_WINDOW_MS) {
        continue; // Respect exponential backoff window
      }
    }

    try {
      await enqueueMediaAnalyze(candidate.id);
      enqueued += 1;
      mediaLogger.info(
        { mediaId: candidate.id },
        "transcription backfill sweep enqueued media for analyze"
      );
    } catch (error) {
      console.error(
        `Transcription backfill enqueue failed for ${candidate.id}:`,
        error
      );
    }
  }

  if (enqueued > 0) {
    mediaLogger.info(
      { count: enqueued },
      "transcription backfill sweep enqueued media"
    );
  }
  return { enqueued };
}

// Semantic classification backfill: re-runs only the recommendation metadata
// stage for READY media produced by an older classifier. The analyze job keeps
// existing OCR/transcripts and skips safety/transcription during this refresh.
// The version marker makes this bounded and safe to run on every deployment.
export async function semanticClassificationBackfillSweep(): Promise<{
  enqueued: number;
}> {
  if (!workerEnv.BACKFILL_ENABLED) {
    return { enqueued: 0 };
  }

  const candidateRows = await prisma.orm.public.PostMedia.select(
    "id",
    "techMetadata"
  )
    .where((media) =>
      and(media.status.eq("READY"), media._type.in(["AUDIO", "IMAGE", "VIDEO"]))
    )
    .orderBy((media) => media.createdAt.asc())
    .all();
  const candidates = candidateRows
    .filter((candidate) => {
      const metadata =
        candidate.techMetadata && typeof candidate.techMetadata === "object"
          ? (candidate.techMetadata as Record<string, unknown>)
          : null;
      return (
        metadata?.semanticClassificationVersion !==
        SEMANTIC_CLASSIFICATION_VERSION
      );
    })
    .slice(0, SWEEP_BATCH);

  let enqueued = 0;
  for (const candidate of candidates) {
    const metadata =
      candidate.techMetadata && typeof candidate.techMetadata === "object"
        ? (candidate.techMetadata as Record<string, unknown>)
        : null;
    if (
      metadata?.semanticClassificationVersion ===
      SEMANTIC_CLASSIFICATION_VERSION
    ) {
      continue;
    }

    try {
      await enqueueMediaAnalyze(candidate.id, { semanticRefresh: true });
      enqueued += 1;
    } catch (error) {
      mediaLogger.warn(
        { error: String(error), mediaId: candidate.id },
        "semantic classification backfill enqueue failed"
      );
    }
  }

  if (enqueued > 0) {
    mediaLogger.info(
      { count: enqueued, version: SEMANTIC_CLASSIFICATION_VERSION },
      "semantic classification backfill enqueued media"
    );
  }
  return { enqueued };
}

// Registers self-healing schedules on the media queue. Idempotent via
// upsertJobScheduler.
export async function registerSweepSchedulers(connectionOptions: {
  maxRetriesPerRequest: null | number;
  url: string;
}): Promise<Worker> {
  const { Queue } = await import("bullmq");
  const queue = new Queue("media-sweeps", { connection: connectionOptions });
  const daily = 24 * 60 * 60 * 1000;
  const thirtyMinutes = 30 * 60 * 1000;
  await queue.upsertJobScheduler("media-legacy-migration", { every: daily });
  await queue.upsertJobScheduler("media-legacy-gc", { every: daily });
  await queue.upsertJobScheduler("media-quarantine-gc", { every: daily });
  await queue.upsertJobScheduler("media-derived-heal", { every: daily });
  await queue.upsertJobScheduler("media-storage-integrity", {
    every: thirtyMinutes,
  });
  await queue.upsertJobScheduler("media-transcription-backfill", {
    every: thirtyMinutes,
  });
  await queue.upsertJobScheduler("media-semantic-classification-backfill", {
    every: thirtyMinutes,
  });
  const sweepWorker = new Worker(
    "media-sweeps",
    async (job) => {
      switch (job.name) {
        case "media-legacy-migration":
        case "media-backfill-sweep": {
          return await legacyMigrationSweep();
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
        case "media-storage-integrity": {
          return await storageIntegritySweep();
        }
        case "media-transcription-backfill": {
          return await transcriptionBackfillSweep();
        }
        case "media-semantic-classification-backfill": {
          return await semanticClassificationBackfillSweep();
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
  sweepWorker.on("error", (error) => {
    mediaLogger.error({ error: String(error) }, "sweep worker error");
  });

  // Run an initial pass on worker boot so existing uncaptioned videos start processing immediately
  void (async () => {
    try {
      await transcriptionBackfillSweep();
      await semanticClassificationBackfillSweep();
    } catch (error) {
      mediaLogger.warn(
        { error: String(error) },
        "initial transcription backfill pass failed"
      );
    }
  })();

  return sweepWorker;
}

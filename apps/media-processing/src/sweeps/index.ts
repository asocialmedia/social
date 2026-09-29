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
  or,
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
  //
  // Three shapes land here, and all three mean the same thing: the row is
  // holding unscanned bytes and nothing is going to scan them. Either it never
  // went through the pipeline (pipelineVersion is null), or it DID publish once
  // and has since lost its published object and been reset to QUARANTINED to
  // republish (pipelineVersion set, publishedKey not). A published row is READY,
  // so requiring the missing published key keeps every healthy row out.
  //
  // This deliberately does NOT require originalKey to sit under quarantine/.
  // That is true of a fresh upload and false of two real shapes: a row migrated
  // off the legacy key, whose originalKey is the live serving object, and a row
  // the storage-integrity sweep reset to republish from a surviving legacy key.
  // Both park in QUARANTINED with nothing pointing at quarantine/, so filtering
  // on the prefix silently excluded exactly the rows most likely to have lost
  // their scan job - stranding them for good. Re-enqueueing is safe for any of
  // them: the scan stage claims QUARANTINED rows conditionally, and it only
  // deletes originalKey on rejection when that key is under quarantine/, so a
  // live serving object is never reaped by a retry.
  const unscanned = await prisma.orm.public.PostMedia.select("id")
    .where((media) =>
      and(
        media.createdAt.lt(cutoffTemporal),
        media.originalKey.isNotNull(),
        or(media.pipelineVersion.isNull(), media.publishedKey.isNull()),
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
// Repairs come in three shapes, in decreasing order of what is still on disk:
//
//  1. A missing DERIVATIVE is rebuilt by one enqueue: processMedia writes every
//     derivative object to S3 BEFORE persisting its row, and
//     persistMediaDerivatives only skips the redundant row insert, so a re-run
//     re-uploads the bytes that vanished. Same for thumbnailKey, which is
//     written from the current version's poster key.
//  2. A missing SOURCE whose quarantine original (originalKey) survived is
//     rebuilt by handing the row back to the scan stage, which re-verifies and
//     re-promotes the exact upload out of quarantine. Retiring such a row would
//     throw away the last copy: quarantine GC deletes originalKey from FAILED
//     rows once retention passes, so a recoverable storage loss would become
//     permanent loss of the bytes.
//  3. A missing source with nothing left anywhere is genuinely unrecoverable,
//     so the row is retired with a failureCode - the feed then shows a
//     placeholder rather than a player that can never load.
//
// A custom thumbnail is the one object nothing can rebuild: it is a COPY of
// another row's published original, taken when the author attached it, and the
// source is not recorded anywhere. Re-running processMedia regenerates the
// pipeline poster but not the author's cover, so the dangling pointer is
// cleared instead - the same fallback attachCustomThumbnail performs, which
// makes the thumbnail URL serve the poster again instead of 404ing forever.
export async function storageIntegritySweep(): Promise<{
  checked: number;
  healed: number;
  repointed: number;
  republished: number;
  retired: number;
}> {
  if (!workerEnv.BACKFILL_ENABLED) {
    return {
      checked: 0,
      healed: 0,
      repointed: 0,
      republished: 0,
      retired: 0,
    };
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
  let repointed = 0;
  let republished = 0;
  let retired = 0;
  for (const row of candidates) {
    // The object the read route will actually stream is `publishedKey || key`
    // (resolveObjectKey in apps/web/src/app/api/media/[mediaId]/route.ts), so
    // THAT is what has to be present - not "some copy of the row is". The two
    // columns are not interchangeable: the scan stage writes publishedKey and
    // then the legacy key in two separate updates, so a row can carry a live
    // legacy object under `key` and nothing usable under `publishedKey` (or the
    // reverse). Probing the pair as alternatives would call such a row healthy
    // while every request 404s on the key the route prefers, and would skip the
    // republish the surviving quarantine original could still do.
    const servedKey = row.publishedKey || row.key || "";
    const retained = dedupeKeys([row.originalKey]);
    if (!servedKey && retained.length === 0) {
      continue;
    }
    try {
      const probed = new Set<string>();
      let servedAlive = false;
      let unproven = false;
      const goneKeys: string[] = [];
      if (servedKey) {
        probed.add(servedKey);
        const probe = await probeAuthoritative(servedKey);
        if (probe === "present") {
          servedAlive = true;
        } else if (probe === "unknown") {
          unproven = true;
        } else {
          goneKeys.push(servedKey);
        }
      }
      if (unproven && !servedAlive) {
        // An unreadable storage is "unknown", not data loss, and must leave the
        // row untouched.
        console.error(
          `Storage-integrity could not read the source for ${row.id}; leaving it for the next pass`
        );
        continue;
      }
      if (!servedAlive && goneKeys.length > 0) {
        // The object the route serves is gone. Before writing the row off, look
        // for ANY copy of the bytes a rescan could still promote.
        //
        // The retained quarantine original is the usual one. The OTHER key
        // column matters just as much, though: the scan stage writes
        // publishedKey and then the legacy key in two separate updates, so a row
        // can lose its published object and still have live bytes filed under
        // `key` - the pre-pipeline serving object, which is the same original
        // the scan stage would promote. When retention has already cleared
        // originalKey, retiring on the served key alone would throw away bytes
        // that are still on disk, and the row would 404 for as long as the
        // pointer to them survived.
        //
        // Both are only ever used as a SCAN SOURCE. Nothing repoints publishedKey
        // at an existing object: that object is an unsanitised original, and the
        // published key is contractually the stripped, watermarked, C2PA-stamped
        // copy. Re-running the scan is what re-applies those.
        const alternateKey =
          servedKey === row.publishedKey && row.key && row.key !== servedKey
            ? row.key
            : null;
        const survivors = dedupeKeys([...retained, alternateKey]);
        let scanSource: null | string = null;
        let unprovenSource = false;
        for (const candidate of survivors) {
          probed.add(candidate);
          const probe = await probeAuthoritative(candidate);
          if (probe === "present") {
            scanSource = candidate;
            break;
          }
          if (probe === "unknown") {
            unprovenSource = true;
          }
        }
        if (unprovenSource && !scanSource) {
          console.error(
            `Storage-integrity could not read a surviving source for ${row.id}; leaving it for the next pass`
          );
          continue;
        }
        if (!scanSource) {
          // Nothing anywhere still holds the bytes. Retiring is now the honest
          // answer, and the only irreversible one - quarantine GC deletes
          // originalKey from FAILED rows once retention passes.
          await prisma.orm.public.PostMedia.where({ id: row.id }).update({
            failureCode: "storage-missing",
            failureDetail: {
              detail:
                "source object missing from storage; nothing can regenerate it",
              key: goneKeys.join(", "),
            },
            status: "FAILED",
          });
          retired += 1;
          mediaLogger.warn(
            { key: goneKeys.join(", "), mediaId: row.id },
            "storage-integrity retired row with no source bytes"
          );
          continue;
        }
        // Republish rather than retire: put the row back in QUARANTINED with no
        // published key, which is exactly the state the scan stage is built to
        // claim, point originalKey at whichever copy survived, and hand it to the
        // queue. Clearing publishedKey also takes the row out of quarantine
        // GC's published-rows branch, so the surviving source cannot be deleted
        // out from under the recovery. The row leaves this sweep's candidate set
        // with the reset, so a slow queue cannot spin the recovery, and
        // derivedHealSweep re-enqueues the scan if the job is swallowed.
        //
        // Pointing originalKey at a legacy `media/...` object is the same
        // tolerance legacyMigrationSweep relies on: the scan stage only deletes
        // originalKey on rejection when it sits under quarantine/, so a live
        // serving object is never reaped by a failed rescan.
        const reset = await prisma.orm.public.PostMedia.where({
          id: row.id,
        }).updateAndCount({
          failureCode: null,
          failureDetail: null,
          key: "",
          originalKey: scanSource,
          publishedKey: null,
          status: "QUARANTINED",
        });
        if (reset > 0) {
          // The reset is already committed, so a failed enqueue leaves the row
          // in QUARANTINED with a source and no job. That is recoverable -
          // derivedHealSweep re-enqueues any stranded QUARANTINED row - but it
          // is a hole worth saying out loud, because the row is unservable until
          // something picks it up.
          try {
            await enqueueMediaScan(row.id, {
              jobIdSuffix: `integrity-republish-${Date.now()}`,
            });
            republished += 1;
            mediaLogger.warn(
              { gone: goneKeys.join(", "), mediaId: row.id, scanSource },
              "storage-integrity requeued row to republish from a surviving source"
            );
          } catch (error) {
            mediaLogger.error(
              { error: String(error), mediaId: row.id, scanSource },
              "row was reset for republish but the scan enqueue failed; leaving it to the derived-heal net"
            );
          }
        }
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
      // The thumbnail columns are served directly by the read route, so a lost
      // object there 404s every feed card for this post even when the
      // derivative rows are all intact. thumbnailKey is written from the
      // current version's poster key, so a miss there is always repairable.
      if (row.thumbnailKey && !probed.has(row.thumbnailKey)) {
        probed.add(row.thumbnailKey);
        const probe = await probeObject(row.thumbnailKey);
        if (probe === "unknown") {
          undeterminable = true;
        } else if (probe === "absent") {
          missing.push(`thumb:${row.thumbnailKey}`);
          repairable.push(row.thumbnailKey);
        }
      }
      // A custom thumbnail is the author's own cover, copied in from another
      // row's published original at attach time. Nothing records which row that
      // was, so no job can recreate the object - processMedia regenerates the
      // pipeline poster and leaves this key untouched. Re-enqueueing on it would
      // burn a full transcode every cycle and count as healed while the URL kept
      // 404ing. Clearing the pointer is the same fallback the author gets when
      // they detach the cover, and the read route then serves the poster.
      //
      // This is a destructive edit to a user's choice, so it gets both
      // safeguards the source deletion has. The probe is confirmed, because one
      // NoSuchKey is exactly as likely to be a storage hiccup here as it is for
      // the source, and a transient answer must not cost the author their cover.
      // And the write is conditional on the key still being the one that was
      // probed: between reading this row and writing, the author may have
      // attached a NEW cover, and clearing by id alone would throw that away
      // because the OLD one is the one that went missing.
      const droppedCustomThumbnail = row.customThumbnailKey;
      if (
        droppedCustomThumbnail &&
        !probed.has(droppedCustomThumbnail) &&
        !undeterminable
      ) {
        probed.add(droppedCustomThumbnail);
        const probe = await probeAuthoritative(droppedCustomThumbnail);
        if (probe === "unknown") {
          undeterminable = true;
        } else if (probe === "absent") {
          missing.push(`thumb:${droppedCustomThumbnail}`);
          const cleared = await prisma.orm.public.PostMedia.where((media) =>
            and(
              media.id.eq(row.id),
              media.customThumbnailKey.eq(droppedCustomThumbnail)
            )
          ).updateAndCount({ customThumbnailKey: null });
          if (cleared > 0) {
            repointed += 1;
            mediaLogger.warn(
              { key: droppedCustomThumbnail, mediaId: row.id },
              "storage-integrity cleared an unrecoverable custom thumbnail so serving falls back to the poster"
            );
          } else {
            // The author replaced the cover while this row was being verified.
            // Their new choice is not the one that went missing, so it stands.
            mediaLogger.info(
              { key: droppedCustomThumbnail, mediaId: row.id },
              "custom thumbnail was replaced mid-sweep; leaving the new cover alone"
            );
          }
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

  if (checked > 0 || retired > 0 || republished > 0 || repointed > 0) {
    mediaLogger.info(
      { checked, healed, repointed, republished, retired },
      "storage-integrity sweep verified READY media"
    );
  }
  return { checked, healed, repointed, republished, retired };
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
    const { code } = error as { code?: string };
    return code === "NoSuchKey" || code === "NotFound" ? "absent" : "unknown";
  }
}

// The verdict for a key a decision rests on. The first probe decides, and a
// definitive "absent" is confirmed by a second one, so a single hiccup can
// never be read as data loss. objectExists in ../s3 collapses every failure to
// "not there", which is fine for a liveness check but must never gate a
// permanent state change on its own.
async function probeAuthoritative(key: string): Promise<ObjectProbe> {
  const first = await probeObject(key);
  if (first !== "absent") {
    return first;
  }
  await Bun.sleep(500);
  // The retry's verdict is the one that counts, INCLUDING when the retry cannot
  // reach storage. "unknown" has to stay unknown: reporting a transport fault as
  // "present" would certify an object this process never actually read, and the
  // sweep would then count the row as verified on the strength of a guess. A
  // first miss plus an unreadable retry is unproven, and unproven never mutates
  // a row - it just leaves it for the next pass.
  return await probeObject(key);
}

// The key columns overlap: a pipeline row dual-writes the same object into
// publishedKey and the legacy key column, and a quarantined row carries "" in
// one of them. Probing the same object twice wastes a request and muddies the
// probe log, so the list is compacted and de-duplicated once, in priority
// order.
function dedupeKeys(keys: (null | string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const key of keys) {
    if (key) {
      seen.add(key);
    }
  }
  return [...seen];
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

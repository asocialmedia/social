// Stage 1 of the media pipeline: security scanning. The original upload is
// untrusted; this stage hashes it, verifies its content against its claimed
// type, enforces resource limits, and runs antivirus. Only scanned, verified
// bytes are promoted out of quarantine.

import { enqueueMediaProcess, Prisma, prisma } from "@asm/db";
import {
  MEDIA_ENCODER_VERSION,
  MEDIA_PIPELINE_VERSION,
  isStampableForC2Pa,
  publishedKey,
  readJpegExifOrientation,
  sanitizeExtension,
  stripImageMetadata,
  verifyDeclaredMatchesContent,
} from "@asm/media";
import type { MediaScanJobData } from "@asm/media";

import {
  scanStream,
  ClamAvSizeLimitError,
  ClamAvUnavailableError,
} from "../clamav";
import { resolveWorkerMediaLimits, workerEnv } from "../env";
import { mediaLogger, withSpan } from "../log";
import { inspectAssetProvenance } from "../provenance/reader";
import { stampAiGenerated } from "../provenance/stamp";
import { getS3 } from "../s3";

const SCAN_LIMITS = resolveWorkerMediaLimits();

export interface ScanOutcome {
  detail?: string;
  outcome: "published" | "rejected" | "skipped";
}

type RejectionReasonCode =
  | "CORRUPT"
  | "MALWARE"
  | "MIME_MISMATCH"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE";

// Static raster formats whose metadata containers (EXIF GPS, XMP, IPTC,
// PNG text) get structurally stripped before publication. Animated sources
// and everything else publish their scanned bytes untouched.
const METADATA_STRIPABLE_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

async function refundStorageQuota(
  userId: string | null,
  size: number
): Promise<void> {
  if (!userId || size <= 0) {
    return;
  }
  try {
    const { redis } = await import("@asm/db");
    await redis.decrby(`user:storage:${userId}`, size);
  } catch (error) {
    console.error("Failed to refund storage quota:", error);
  }
}

async function rejectMedia(
  mediaId: string,
  reason: RejectionReasonCode,
  failureCode: string,
  detail: string
): Promise<ScanOutcome> {
  const row = await prisma.media.findUnique({
    select: { originalKey: true, size: true, userId: true },
    where: { id: mediaId },
  });
  // Quarantined rejected bytes never linger - but ONLY true quarantine
  // copies. Backfilled legacy rows point originalKey at the live serving
  // object; deleting that on a rejection would break every post using it.
  if (row?.originalKey?.startsWith("quarantine/")) {
    try {
      await getS3().delete(row.originalKey);
    } catch (error) {
      console.error(
        `Failed to delete quarantined object for ${mediaId}:`,
        error
      );
    }
  }
  if (row) {
    await refundStorageQuota(row.userId, row.size);
  }
  await prisma.media.updateMany({
    data: {
      failureCode,
      failureDetail: { detail },
      rejectedReason: reason,
      status: "REJECTED",
    },
    where: { id: mediaId },
  });
  mediaLogger.warn({ mediaId, reason }, "media rejected during scan");
  return { detail, outcome: "rejected" };
}

export function processMediaScan(
  jobData: MediaScanJobData
): Promise<ScanOutcome> {
  const { mediaId } = jobData;
  return withSpan(
    "job.media-scan",
    async () => {
      const media = await prisma.media.findUnique({ where: { id: mediaId } });
      if (!media || !media.originalKey) {
        return { detail: "row or object key missing", outcome: "skipped" };
      }
      // Legacy rows migrating through the backfill sweep are recognized by
      // their live serving key (new uploads keep key="" until publish).
      // These bytes have been served publicly for years, so verification is
      // tolerant below: a sloppy historical mimeType or size column must
      // never flip a working post's attachment into REJECTED.
      const isLegacyBackfillRow =
        media.pipelineVersion === null && media.key.length > 0;
      if (["DELETED", "REJECTED", "READY"].includes(media.status)) {
        return { detail: `status ${media.status}`, outcome: "skipped" };
      }

      // Conditional claim: duplicate jobs and post-crash retries become
      // no-ops instead of double-processing. PROCESSING is also claimable:
      // the row enters it between the publish flips, so a worker dying
      // mid-scan (OOM, crash, dev restart) would otherwise strand the row
      // forever - no serving object exists yet, and the original is still
      // under quarantine/, so rescanning is the only recovery path. A row
      // already carrying a published key in PROCESSING is being actively
      // published by a live worker and stays off-limits (guarded below).
      const claim = await prisma.media.updateMany({
        data: { attempts: { increment: 1 }, status: "SCANNING" },
        where:
          media.status === "PROCESSING" && !media.publishedKey
            ? { id: mediaId, publishedKey: null, status: "PROCESSING" }
            : { id: mediaId, status: "QUARANTINED" },
      });
      if (claim.count === 0) {
        return {
          detail: `status ${media.status} not claimable`,
          outcome: "skipped",
        };
      }

      const tempPath = `/tmp/asm-scan-${mediaId}-${crypto.randomUUID()}`;
      const strippedPath = `${tempPath}-stripped`;
      const stampedPath = `${tempPath}-c2pa`;

      try {
        const s3 = getS3();
        const source = s3.file(media.originalKey).stream();

        // 1. Stream once into a local copy for the scanner, counting bytes.
        let totalBytes = 0;
        const writer = Bun.file(tempPath).writer();
        const reader = source.getReader();
        // Streaming is inherently sequential; parallel collection would
        // reorder the copy.
        // oxlint-disable-next-line no-await-in-loop -- ordered stream consumption
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop -- ordered stream consumption
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          totalBytes += value.byteLength;
          writer.write(value);
        }
        await writer.end();
        reader.releaseLock();

        // 2. Reality check on size before anything else. Backfilled legacy
        // rows adopt the actual stored size instead of rejecting - the
        // bytes on storage are by definition what has been serving.
        if (totalBytes <= 0 || totalBytes !== media.size) {
          if (!isLegacyBackfillRow || totalBytes <= 0) {
            return await rejectMedia(
              mediaId,
              "CORRUPT",
              "size-mismatch",
              `declared ${media.size} bytes, stored ${totalBytes}`
            );
          }
          mediaLogger.warn(
            { declared: media.size, mediaId, stored: totalBytes },
            "legacy backfill size mismatch tolerated"
          );
        }

        // 3. Content-based type detection; declared MIME is untrusted.
        // Legacy (pre-pipeline) rows carry no claimedMime - their original
        // upload MIME lives in the legacy mimeType column and is the best
        // available declaration for the backfill path.
        const declaredMime = media.claimedMime ?? media.mimeType ?? "";
        const headBuffer = Buffer.from(
          await Bun.file(tempPath).slice(0, 512).arrayBuffer()
        );
        const verification = verifyDeclaredMatchesContent(
          headBuffer,
          declaredMime
        );
        if (!verification.detected) {
          // Undetectable bytes are rejected even for legacy rows - fail
          // closed when the content type is unknown.
          return await rejectMedia(
            mediaId,
            "UNSUPPORTED_TYPE",
            "content-mismatch",
            verification.reason ?? "unrecognized content"
          );
        }
        if (!verification.ok) {
          // Detection succeeded but disagrees with the declaration. New
          // uploads treat that as a rejection signal; legacy rows adopt the
          // detected type instead - a sloppy historical mimeType must never
          // 404 a post attachment that has been serving for years.
          if (!isLegacyBackfillRow) {
            return await rejectMedia(
              mediaId,
              "MIME_MISMATCH",
              "content-mismatch",
              verification.reason ?? "declared type does not match content"
            );
          }
          mediaLogger.warn(
            {
              declaredMime,
              detectedMime: verification.detected.mime,
              mediaId,
            },
            "legacy backfill mime mismatch tolerated"
          );
        }
        const { detected } = verification;

        // 3b. Provenance: classify embedded C2PA manifests for AI-generation
        // signals (generator identity, digitalSourceTypes, metadata labels).
        // Best-effort - assets without manifests are the common case and
        // inspection failures never block publication.
        const provenance = await inspectAssetProvenance(
          tempPath,
          detected.mime
        );
        if (provenance?.verdict.aiGenerated) {
          mediaLogger.info(
            {
              evidence: provenance.verdict.evidence.length,
              generators: provenance.verdict.generators,
              mediaId,
            },
            "upload classified as AI-generated"
          );
        }

        // 4. Antivirus. Fail-closed when a scanner is configured but
        // unreachable: unscanned bytes never get published.
        let scanned = false;
        if (workerEnv.CLAMAV_HOST) {
          try {
            const verdict = await scanStream(
              Bun.file(tempPath).stream(),
              SCAN_LIMITS.scanTimeoutMs
            );
            scanned = true;
            if (!verdict.clean) {
              return await rejectMedia(
                mediaId,
                "MALWARE",
                "malware",
                verdict.signature ?? "signature match"
              );
            }
          } catch (error) {
            if (error instanceof ClamAvUnavailableError) {
              throw error;
            }
            if (error instanceof ClamAvSizeLimitError) {
              // The file exceeds the daemon's StreamMaxLength - a property
              // of the upload, so reject with a user-facing reason instead
              // of retrying forever as a scanner problem.
              return await rejectMedia(
                mediaId,
                "TOO_LARGE",
                "av-size-limit",
                "file exceeds the antivirus scanner's size limit"
              );
            }
            return await rejectMedia(
              mediaId,
              "CORRUPT",
              "scan-error",
              String(error)
            );
          }
        } else if (workerEnv.REQUIRE_CLAMAV) {
          throw new ClamAvUnavailableError(
            "scanning required but CLAMAV_HOST is unset"
          );
        } else {
          mediaLogger.warn(
            { mediaId },
            "[dev] AV scanning skipped (CLAMAV_HOST unset)"
          );
        }

        // 4b. Publish gate: promote verified bytes into the media prefix,
        // then flip SCANNING -> PROCESSING -> READY with conditional updates
        // so a concurrent mutation can never publish twice.
        const firstFlip = await prisma.media.updateMany({
          data: { status: "PROCESSING" },
          where: { id: mediaId, status: "SCANNING" },
        });
        if (firstFlip.count === 0) {
          return { detail: "lost claim", outcome: "skipped" };
        }

        const extension = sanitizeExtension(detected.mime.split("/")[1]);

        // 5. Lossless metadata strip: EXIF (GPS!), XMP, IPTC and PNG text
        // containers never leave quarantine attached to served bytes. The
        // rewrite is structural, so pixels are untouched; ICC color profiles
        // and any C2PA/JUMBF provenance chain survive. Failure publishes the
        // scanned bytes unmodified rather than blocking the upload.
        let publishPath = tempPath;
        let exifStripped = false;
        let capturedOrientation: number | undefined;
        if (METADATA_STRIPABLE_MIMES.has(detected.mime)) {
          try {
            const sourceBytes = new Uint8Array(
              await Bun.file(tempPath).arrayBuffer()
            );
            if (detected.mime === "image/jpeg" && sourceBytes.length > 4) {
              // Locate the EXIF APP1 segment so readJpegExifOrientation sees
              // the payload rather than the SOI.
              for (let pos = 2; pos + 4 < sourceBytes.length;) {
                if (sourceBytes[pos] !== 0xff) {
                  break;
                }
                const marker = sourceBytes[pos + 1] ?? 0;
                if (marker === 0xd9 || marker === 0xda) {
                  break;
                }
                if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                  pos += 2;
                  continue;
                }
                const segLen =
                  ((sourceBytes[pos + 2] ?? 0) << 8) |
                  (sourceBytes[pos + 3] ?? 0);
                if (segLen < 2 || pos + 2 + segLen > sourceBytes.length) {
                  break;
                }
                if (marker === 0xe1) {
                  const orientation = readJpegExifOrientation(
                    sourceBytes,
                    pos + 4,
                    pos + 2 + segLen
                  );
                  if (orientation > 1) {
                    capturedOrientation = orientation;
                  }
                  break;
                }
                pos += 2 + segLen;
              }
            }
            const outcome = stripImageMetadata(sourceBytes);
            if (outcome?.stripped) {
              await Bun.write(strippedPath, outcome.bytes);
              publishPath = strippedPath;
              exifStripped = true;
            }
          } catch (error) {
            mediaLogger.warn(
              { error: String(error), mediaId },
              "metadata stripping failed; publishing unmodified"
            );
          }
        }

        // 6. Stamp AI-flagged assets with our own signed manifest before
        // they leave quarantine. Runs on the stripped file so the embedded
        // manifest is the only metadata added back. Falls back to the
        // current bytes whenever no signing identity is configured, the
        // format can't carry an embedded manifest, or stamping fails -
        // detection stays recorded.
        let stamped = false;
        if (
          provenance?.verdict.aiGenerated &&
          workerEnv.C2PA_STAMP_ENABLED &&
          isStampableForC2Pa(detected.mime)
        ) {
          try {
            stamped = await stampAiGenerated(publishPath, stampedPath, {
              detectionReason: provenance.verdict.evidence[0]?.detail ?? "ai",
              mediaId,
              mime: detected.mime,
            });
            if (stamped) {
              publishPath = stampedPath;
            }
          } catch (error) {
            mediaLogger.warn(
              { error: String(error), mediaId },
              "C2PA stamping failed; publishing unstamped"
            );
          }
        }

        // 7. Hash the exact bytes being published (post strip/stamp) so the
        // stored digest and content-hashed key describe the served object,
        // then promote it out of quarantine.
        const publishHasher = new Bun.CryptoHasher("sha256");
        for await (const chunk of Bun.file(publishPath).stream()) {
          publishHasher.update(chunk);
        }
        const sha256 = publishHasher.digest("hex");

        const targetKey = publishedKey(media.id, extension, sha256);

        // Platform-level metadata is attached to the DB record here, at the
        // moment verified bytes leave quarantine - never embedded into the
        // binary, which any downstream re-upload could strip. The database
        // row is the authoritative provenance source. The duplicate lookup
        // is a detection signal only (same SHA-256 = byte-identical upload);
        // it says nothing about ownership.
        const [uploader, existingDuplicate] = await Promise.all([
          media.userId
            ? prisma.user.findUnique({
                select: { displayName: true },
                where: { id: media.userId },
              })
            : Promise.resolve(null),
          prisma.media.findFirst({
            select: { id: true },
            where: {
              id: { not: mediaId },
              publishedKey: { not: null },
              sha256,
            },
          }),
        ]);

        await s3.write(targetKey, Bun.file(publishPath));

        const secondFlip = await prisma.media.updateMany({
          data: {
            aiGenerated: provenance ? provenance.verdict.aiGenerated : null,
            aiProvenance: provenance
              ? (structuredClone({
                  ...provenance.verdict,
                  detectedAt: new Date().toISOString(),
                  stamped,
                }) as object)
              : Prisma.DbNull,
            detectedMime: detected.mime,
            // True when the published original had its metadata containers
            // structurally removed above; derivatives are always stripped
            // by re-encoding regardless.
            duplicateOf: existingDuplicate?.id ?? null,
            encoderVersion: MEDIA_ENCODER_VERSION,
            exifStripped,
            pipelineVersion: MEDIA_PIPELINE_VERSION,
            platform: "asocialmedia.cc",
            processedAt: new Date(),
            publishedKey: targetKey,
            sha256,
            size: totalBytes,
            status: "READY",
            techMetadata: {
              avScanned: scanned,
              container: detected.container,
              family: detected.family,
              ...(capturedOrientation
                ? { orientation: capturedOrientation }
                : {}),
              ...(provenance
                ? {
                    c2pa: {
                      claimGenerator: provenance.claimGenerator,
                      generators: provenance.verdict.generators,
                      manifestCount: provenance.verdict.c2paPresent ? 1 : 0,
                    },
                  }
                : {}),
            },
            uploaderDisplayName: uploader?.displayName ?? null,
          },
          where: { id: mediaId, status: "PROCESSING" },
        });

        if (secondFlip.count > 0) {
          // Dual-write legacy columns so today's serving route renders this
          // media immediately; variant serving supersedes in phase 2 without
          // touching this contract.
          await prisma.media.update({
            data: {
              key: targetKey,
              mimeType: detected.mime,
              url: `${workerEnv.ASMOB_ENDPOINT}/${workerEnv.ASMOB_BUCKET}/${targetKey}`,
            },
            where: { id: mediaId },
          });
        }

        // Derivative generation follows publication asynchronously; the row
        // is already READY and servable at this point. The enqueue is
        // awaited (not fire-and-forget): a Redis blip here used to strand
        // freshly published rows with zero derivatives forever, because no
        // later stage ever retried it. Failure after publish must not
        // re-enter the catch below (the row is READY, rethrowing would only
        // burn three doomed scan retries) - the daily derived-heal sweep is
        // the durable net for this window.
        try {
          await enqueueMediaProcess(mediaId);
        } catch (error: unknown) {
          mediaLogger.error(
            { error: String(error), mediaId },
            "process enqueue failed; deferring to derived-heal sweep"
          );
        }

        // Original retention: keep the exact uploaded bytes under quarantine/
        // for the configured window (forensics, re-processing, incident
        // review) - the retention sweep deletes them once it passes. Only the
        // strip/stamp-free published copy would be byte-identical anyway, so
        // for stripped or stamped media this is the sole surviving original.
        // retentionDays <= 0 restores immediate deletion.
        const retentionDays = SCAN_LIMITS.originalRetentionDays;
        if (retentionDays > 0) {
          mediaLogger.info(
            {
              bytes: totalBytes,
              days: retentionDays,
              mediaId,
              retainedKey: media.originalKey,
            },
            "quarantine original retained for retention window"
          );
        } else {
          await s3.delete(media.originalKey).catch(() => null);
        }

        mediaLogger.info(
          { bytes: totalBytes, mediaId, mime: detected.mime },
          "media published after scan"
        );
        return { outcome: "published" };
      } catch (error) {
        // Infra failures stay retryable: release the claim back to
        // QUARANTINED so BullMQ's next attempt re-scans cleanly. Terminal
        // failure marking happens in the worker's failed handler once BullMQ
        // exhausts attempts.
        await prisma.media.updateMany({
          data: {
            failureCode: "scan-failed",
            failureDetail: { message: String(error) },
            status: "QUARANTINED",
          },
          where: { id: mediaId, status: "SCANNING" },
        });
        throw error;
      } finally {
        await Bun.$`rm -f ${tempPath} ${strippedPath} ${stampedPath}`
          .quiet()
          .catch(() => null);
      }
    },
    { "media.id": mediaId }
  );
}

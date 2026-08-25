// Stage 1 of the media pipeline: security scanning. The original upload is
// untrusted; this stage hashes it, verifies its content against its claimed
// type, enforces resource limits, and runs antivirus. Only scanned, verified
// bytes are promoted out of quarantine.

import { enqueueMediaProcess, Prisma, prisma } from "@asm/db";
import {
  MEDIA_PIPELINE_VERSION,
  isStampableForC2Pa,
  publishedKey,
  sanitizeExtension,
  stripImageMetadata,
  verifyDeclaredMatchesContent,
} from "@asm/media";
import type { MediaScanJobData } from "@asm/media";

import { scanStream, ClamAvUnavailableError } from "../clamav";
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
      if (["DELETED", "REJECTED", "READY"].includes(media.status)) {
        return { detail: `status ${media.status}`, outcome: "skipped" };
      }

      // Conditional claim: duplicate jobs and post-crash retries become
      // no-ops instead of double-processing.
      const claim = await prisma.media.updateMany({
        data: { attempts: { increment: 1 }, status: "SCANNING" },
        where: { id: mediaId, status: "QUARANTINED" },
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

        // 2. Reality check on size before anything else.
        if (totalBytes <= 0 || totalBytes !== media.size) {
          return await rejectMedia(
            mediaId,
            "CORRUPT",
            "size-mismatch",
            `declared ${media.size} bytes, stored ${totalBytes}`
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
        if (!verification.ok || !verification.detected) {
          return await rejectMedia(
            mediaId,
            verification.reason === "MIME_MISMATCH"
              ? "MIME_MISMATCH"
              : "UNSUPPORTED_TYPE",
            "content-mismatch",
            verification.reason ?? "unrecognized content"
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
        if (METADATA_STRIPABLE_MIMES.has(detected.mime)) {
          try {
            const sourceBytes = new Uint8Array(
              await Bun.file(tempPath).arrayBuffer()
            );
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
            exifStripped,
            pipelineVersion: MEDIA_PIPELINE_VERSION,
            processedAt: new Date(),
            publishedKey: targetKey,
            sha256,
            size: totalBytes,
            status: "READY",
            techMetadata: {
              avScanned: scanned,
              container: detected.container,
              family: detected.family,
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

        // Derivative generation follows publication asynchronously; the
        // row is already READY and servable at this point.
        void (async () => {
          try {
            await enqueueMediaProcess(mediaId);
          } catch (error: unknown) {
            mediaLogger.error(
              { error: String(error), mediaId },
              "process enqueue failed"
            );
          }
        })();

        // The quarantine copy has served its purpose.
        await s3.delete(media.originalKey).catch(() => null);

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

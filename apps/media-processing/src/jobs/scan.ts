// Stage 1 of the media pipeline: security scanning. The original upload is
// untrusted; this stage hashes it, verifies its content against its claimed
// type, enforces resource limits, and runs antivirus. Only scanned, verified
// bytes are promoted out of quarantine.

import { prisma } from "@asm/db";
import {
  MEDIA_PIPELINE_VERSION,
  publishedKey,
  sanitizeExtension,
  verifyDeclaredMatchesContent,
} from "@asm/media";
import type { MediaScanJobData } from "@asm/media";

import { scanStream, ClamAvUnavailableError } from "../clamav";
import { resolveWorkerMediaLimits, workerEnv } from "../env";
import { mediaLogger, withSpan } from "../log";
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
  if (row?.originalKey) {
    // Quarantined rejected bytes never linger.
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

      try {
        const s3 = getS3();
        const source = s3.file(media.originalKey).stream();

        // 1. Stream once: content hash + local copy for the scanner.
        const hasher = new Bun.CryptoHasher("sha256");
        let totalBytes = 0;
        const writer = Bun.file(tempPath).writer();
        const reader = source.getReader();
        // Streaming is inherently sequential: the hash requires ordered
        // bytes, so parallel collection would be incorrect here.
        // oxlint-disable-next-line no-await-in-loop -- ordered stream consumption
        for (;;) {
          // oxlint-disable-next-line no-await-in-loop -- ordered stream consumption
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          hasher.update(value);
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
        const sha256 = hasher.digest("hex");

        // 3. Content-based type detection; declared MIME is untrusted.
        const headBuffer = Buffer.from(
          await Bun.file(tempPath).slice(0, 512).arrayBuffer()
        );
        const verification = verifyDeclaredMatchesContent(
          headBuffer,
          media.claimedMime ?? ""
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

        // 5. Publish: promote the verified original into the media prefix,
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
        const targetKey = publishedKey(media.id, extension, sha256);
        await s3.write(targetKey, Bun.file(tempPath));

        const secondFlip = await prisma.media.updateMany({
          data: {
            detectedMime: detected.mime,
            // EXIF stripping happens during derivative generation (phase 2);
            // at this point the verified original is served as-is.
            exifStripped: false,
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
        await Bun.$`rm -f ${tempPath}`.quiet().catch(() => null);
      }
    },
    { "media.id": mediaId }
  );
}

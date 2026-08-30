import {
  consumeRateLimit,
  cancelMediaCleanup,
  Prisma,
  prisma,
  redis,
} from "@asm/db";
import {
  maxBytesForType,
  quarantineKey,
  resolveMediaLimits,
  sanitizeExtension,
} from "@asm/media";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../env";
import {
  mediaTypeFromMime,
  sanitizeDisplayName,
  UploadPolicyError,
} from "./upload-policy";

export {
  mediaTypeFromMime,
  sanitizeDisplayName,
  UploadPolicyError,
} from "./upload-policy";

// Server-side media limits resolved once per process from environment
// overrides (MEDIA_* vars); defaults live in @asm/media and are mirrored to
// the client through DEFAULT_LIMITS.
export const MEDIA_LIMITS = resolveMediaLimits(
  process.env as Record<string, string | undefined>
);

// Presigned PUTs must be signed against the hostname the browser will
// actually hit: SigV4 folds the host into the signature, so rewriting the
// host afterwards breaks them. When a public storage endpoint is configured
// (uploads.asocialmedia.cc), signing happens against that host instead of
// the internal one.
let presignClient: S3Client | null = null;

function getPresignClient(): S3Client {
  if (!presignClient) {
    const endpoint = env.ASMOB_PUBLIC_ENDPOINT ?? env.ASMOB_ENDPOINT;
    presignClient = new S3Client({
      credentials: {
        accessKeyId: env.ASMOB_ROOT_USER,
        secretAccessKey: env.ASMOB_ROOT_PASSWORD,
      },
      endpoint: /^https?:\/\//i.test(endpoint)
        ? endpoint
        : `https://${endpoint}`,
      forcePathStyle: true,
      maxAttempts: 3,
      region: "ap-south-1",
    });
  }
  return presignClient;
}

export interface InitiatedUpload {
  deduplicated?: boolean;
  extension: string;
  mediaId: string;
  status?: string;
  uploadUrl: string | null;
}

export async function createInitiatedUpload(input: {
  /** When set (gust sound), the uploaded AUDIO media id whose track replaces
   * the video's own audio during pipeline processing. */
  audioOverlayId?: string | null;
  declaredMime: string;
  fileName: string;
  fileSize: number;
  purpose: string | null;
  sha256?: string | null;
  userId: string;
}): Promise<InitiatedUpload> {
  const {
    audioOverlayId,
    declaredMime,
    fileName,
    fileSize,
    purpose,
    sha256,
    userId,
  } = input;

  const mediaType = mediaTypeFromMime(declaredMime);
  const maxBytes = maxBytesForType(MEDIA_LIMITS, mediaType);
  if (fileSize <= 0) {
    throw new UploadPolicyError("File is empty", 400);
  }
  if (fileSize > maxBytes) {
    throw new UploadPolicyError(
      `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit for ${mediaType.toLowerCase()} uploads`,
      413
    );
  }

  // Burst guard independent of the edge IP tier: protects workers from a
  // scripted loop of initiate/finalize pairs on one account.
  const burst = await consumeRateLimit({
    bucket: "media-init-user",
    identifier: userId,
    limit: MEDIA_LIMITS.maxUploadsPerMinutePerUser,
    windowSeconds: 60,
  });
  if (!burst.allowed) {
    throw new UploadPolicyError("Slow down a little", 429);
  }

  const daily = await consumeRateLimit({
    bucket: "upload-user",
    identifier: userId,
    limit: MEDIA_LIMITS.maxUploadsPerDayPerUser,
    windowSeconds: 86_400,
  });
  if (!daily.allowed) {
    throw new UploadPolicyError("Daily upload limit reached", 429);
  }

  // One account may not occupy every processing slot; drafts that were never
  // finalized are excluded because they hold no worker resources.
  const activeJobs = await prisma.media.count({
    where: { status: { in: ["SCANNING", "PROCESSING"] }, userId },
  });
  if (activeJobs >= MEDIA_LIMITS.maxConcurrentProcessingPerUser) {
    throw new UploadPolicyError(
      "Too many uploads are still processing. Try again shortly.",
      429
    );
  }

  // Lifetime storage quota (Redis byte counter maintained by finalize and the
  // deletion cascade). Fails open when Redis is unavailable rather than
  // blocking uploads during an outage.
  try {
    const used = Number((await redis.get(`user:storage:${userId}`)) ?? 0);
    if (
      Number.isFinite(used) &&
      used + fileSize > MEDIA_LIMITS.maxUserStorageBytes
    ) {
      throw new UploadPolicyError("Storage quota exceeded", 507);
    }
  } catch (error) {
    if (error instanceof UploadPolicyError) {
      throw error;
    }
  }

  const extensionGuess = fileName.includes(".")
    ? (fileName.split(".").pop() ?? "")
    : "";

  // Content-addressable deduplication: if the user already uploaded this exact
  // file (matching SHA-256 and size) and it finished processing or is in-flight,
  // reuse the existing media row and storage artifacts to skip redundant uploads
  // and transcoding.
  if (sha256) {
    const existing = await prisma.media.findFirst({
      include: {
        avatarOf: { select: { id: true } },
        bannerOf: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      where: {
        sha256,
        size: fileSize,
        status: {
          in: ["READY", "PROCESSING", "SCANNING", "QUARANTINED", "DELETED"],
        },
        type: mediaType,
        userId,
      },
    });

    if (existing) {
      const isUnattached =
        !existing.postId &&
        !existing.commentId &&
        !existing.avatarOf &&
        !existing.bannerOf;

      // Fast path 1: Existing row reached READY and publishedKey exists
      if (existing.status === "READY" && existing.publishedKey) {
        // A different audio overlay means the stored bytes were baked with
        // another track; reusing them would serve the wrong audio. Fall
        // through to full processing so the overlay is re-baked.
        const overlayMatches =
          (existing.audioOverlayId ?? null) === (audioOverlayId ?? null);
        if (overlayMatches && isUnattached) {
          // An unattached draft already exists (e.g. author uploaded in another tab
          // or cancelled before post): reuse it directly and extend its TTL.
          if (purpose !== "message") {
            try {
              await scheduleMediaCleanup(existing.id);
            } catch (error) {
              console.error("Failed to schedule media cleanup:", error);
            }
          }
          return {
            deduplicated: true,
            extension: sanitizeExtension(extensionGuess),
            mediaId: existing.id,
            status: "READY",
            uploadUrl: null,
          };
        }

        // Fast path 2: Existing row is attached to another post/comment (or
        // was baked with a different audio overlay). Clone the media record
        // referencing the same published objects. Row + derivatives commit
        // atomically: a failure between the two writes would otherwise leave
        // a READY clone with no playable variants.
        if (overlayMatches) {
          const cloned = await prisma.$transaction(async (tx) => {
            const created = await tx.media.create({
              data: {
                aiGenerated: existing.aiGenerated,
                aiProvenance: (existing.aiProvenance ??
                  Prisma.DbNull) as Prisma.InputJsonValue,
                blurDataUrl: existing.blurDataUrl,
                captionsKey: existing.captionsKey,
                claimedMime: existing.claimedMime,
                customThumbnailKey: null,
                detectedMime: existing.detectedMime,
                encoderVersion: existing.encoderVersion,
                exifStripped: existing.exifStripped,
                hasHls: existing.hasHls,
                height: existing.height,
                key: existing.key,
                mimeType: existing.mimeType,
                originalName: sanitizeDisplayName(fileName),
                pipelineVersion: existing.pipelineVersion,
                platform: existing.platform,
                processedAt: new Date(),
                publishedKey: existing.publishedKey,
                semanticTags: existing.semanticTags,
                sha256: existing.sha256,
                size: existing.size,
                status: "READY",
                techMetadata: (existing.techMetadata ??
                  Prisma.DbNull) as Prisma.InputJsonValue,
                thumbnailHeight: existing.thumbnailHeight,
                thumbnailKey: existing.thumbnailKey,
                thumbnailWidth: existing.thumbnailWidth,
                transcript: existing.transcript,
                type: existing.type,
                uploaderDisplayName: existing.uploaderDisplayName,
                uploaderUsername: existing.uploaderUsername,
                url: existing.url,
                userId,
                width: existing.width,
                ...(audioOverlayId ? { audioOverlayId } : {}),
              },
            });

            // Mirror any pre-computed derivative variants
            const existingDerivatives = await tx.mediaDerivative.findMany({
              where: { mediaId: existing.id },
            });
            if (existingDerivatives.length > 0) {
              await tx.mediaDerivative.createMany({
                data: existingDerivatives.map((d) => ({
                  durationMs: d.durationMs,
                  height: d.height,
                  key: d.key,
                  kind: d.kind,
                  mediaId: created.id,
                  mimeType: d.mimeType,
                  pipelineVersion: d.pipelineVersion,
                  sizeBytes: d.sizeBytes,
                  variant: d.variant,
                  width: d.width,
                })),
              });
            }

            return created;
          });

          if (purpose !== "message") {
            try {
              await scheduleMediaCleanup(cloned.id);
            } catch (error) {
              console.error("Failed to schedule media cleanup:", error);
            }
          }
          try {
            await redis.incrby(`user:storage:${userId}`, fileSize);
          } catch (error) {
            console.error("Failed to update storage quota:", error);
          }

          return {
            deduplicated: true,
            extension: sanitizeExtension(extensionGuess),
            mediaId: cloned.id,
            status: "READY",
            uploadUrl: null,
          };
        }
      }

      // Fast path 3: The media was soft-discarded (status DELETED) but its
      // publishedKey is still intact in storage. Revive the row and quota.
      // Cancel any pending cleanup first: the delayed cleanup job would
      // otherwise delete the storage objects out from under the revived row
      // once its 24h delay elapses (cleanup skips attached rows, but a fresh
      // revival is unattached by definition).
      if (
        existing.status === "DELETED" &&
        existing.publishedKey &&
        isUnattached
      ) {
        try {
          await cancelMediaCleanup(existing.id);
        } catch (error) {
          console.error("Failed to cancel pending media cleanup:", error);
        }
        await prisma.media.update({
          data: {
            failureCode: null,
            failureDetail: Prisma.DbNull,
            originalName: sanitizeDisplayName(fileName),
            rejectedReason: null,
            status: "READY",
            ...(audioOverlayId ? { audioOverlayId } : {}),
          },
          where: { id: existing.id },
        });
        if (purpose !== "message") {
          try {
            await scheduleMediaCleanup(existing.id);
          } catch (error) {
            console.error("Failed to schedule media cleanup:", error);
          }
        }
        try {
          await redis.incrby(`user:storage:${userId}`, fileSize);
        } catch (error) {
          console.error("Failed to update storage quota:", error);
        }
        return {
          deduplicated: true,
          extension: sanitizeExtension(extensionGuess),
          mediaId: existing.id,
          status: "READY",
          uploadUrl: null,
        };
      }

      // Fast path 4: In-flight pipeline (SCANNING, PROCESSING, QUARANTINED)
      // for an unattached upload: re-attach to the existing processing job.
      if (
        isUnattached &&
        (existing.status === "SCANNING" ||
          existing.status === "PROCESSING" ||
          existing.status === "QUARANTINED")
      ) {
        if (purpose !== "message") {
          try {
            await scheduleMediaCleanup(existing.id);
          } catch (error) {
            console.error("Failed to schedule media cleanup:", error);
          }
        }
        return {
          deduplicated: true,
          extension: sanitizeExtension(extensionGuess),
          mediaId: existing.id,
          status: existing.status,
          uploadUrl: null,
        };
      }
    }
  }

  const media = await prisma.media.create({
    data: {
      // New-flow rows carry no legacy URL/key; serving falls back to the
      // pipeline's publishedKey + derivatives instead.
      claimedMime: declaredMime.toLowerCase(),
      key: "",
      mimeType: declaredMime.toLowerCase(),
      originalName: sanitizeDisplayName(fileName),
      sha256: sha256 ?? null,
      size: fileSize,
      status: "UPLOADING",
      type: mediaType,
      url: "",
      userId,
      ...(audioOverlayId ? { audioOverlayId } : {}),
    },
  });

  // The quarantine key embeds the generated id, so patch the row once with
  // its final key. Keys stay deterministic and content-free.
  const originalKey = quarantineKey(media.id, extensionGuess);
  await prisma.media.update({
    data: { originalKey },
    where: { id: media.id },
  });

  // Message attachments are end-to-end encrypted payloads; the server can
  // never link them to posts, so orphan cleanup does not apply to them.
  if (purpose !== "message") {
    try {
      await scheduleMediaCleanup(media.id);
    } catch (error) {
      console.error("Failed to schedule media cleanup:", error);
    }
  }

  const uploadUrl = await getSignedUrl(
    getPresignClient(),
    new PutObjectCommand({
      Bucket: env.ASMOB_BUCKET_NAME,
      ContentType: declaredMime,
      Key: originalKey,
      Metadata: {
        mediaId: media.id,
        uploadedAt: new Date().toISOString(),
        userId,
      },
    }),
    { expiresIn: 900 }
  );

  return {
    extension: sanitizeExtension(extensionGuess),
    mediaId: media.id,
    uploadUrl,
  };
}

async function scheduleMediaCleanup(mediaId: string): Promise<void> {
  const { scheduleMediaCleanup: schedule } = await import("@asm/db");
  await schedule(mediaId);
}

// Attaches (or clears) a gust "sound" on a video AFTER the video row exists.
// The overlay normally rides along at initiate time; this covers the
// sound-picked-later flow where the video bytes are already uploading or
// processed. Passing null clears a previously attached track.
//
// The process stage bakes the overlay into every derivative (poster, MP4,
// HLS) when it runs. If derivatives already exist they carry the old audio,
// so they are reset (rows + objects) and processing is re-triggered with a
// fresh dedupe key - a plain re-enqueue would silently collapse onto the
// retained completed process job. While processing is still pending there is
// nothing to reset: the queued run reads the overlay when it starts.
export async function attachAudioOverlay(input: {
  audioOverlayId: string | null;
  mediaId: string;
  userId: string;
}): Promise<{ mediaId: string; reprocessing: boolean }> {
  const { audioOverlayId, mediaId, userId } = input;
  const { deleteObject, enqueueMediaProcess } = await import("@asm/db");
  const { isTerminalStatus } = await import("@asm/media");

  const video = await prisma.media.findFirst({
    select: { id: true, status: true, type: true },
    where: { id: mediaId, userId },
  });
  if (
    !video ||
    video.type !== "VIDEO" ||
    isTerminalStatus(video.status) ||
    video.status === "FAILED"
  ) {
    throw new UploadPolicyError("Media not found", 404);
  }

  if (audioOverlayId) {
    const overlay = await prisma.media.findFirst({
      select: { id: true, status: true, type: true, userId: true },
      where: { id: audioOverlayId },
    });
    if (!overlay || overlay.userId !== userId || overlay.type !== "AUDIO") {
      throw new UploadPolicyError("Sound track not found", 404);
    }
    // The process stage streams the track's published bytes; a row that is
    // not READY has no verified bytes to remux.
    if (overlay.status !== "READY") {
      throw new UploadPolicyError("Sound track is not ready yet", 409);
    }
  }

  try {
    await prisma.media.update({
      data: { audioOverlayId },
      where: { id: video.id },
    });
  } catch (error: unknown) {
    // audioOverlayId is @unique: one sound can back exactly one video.
    if ((error as { code?: string }).code === "P2002") {
      throw new UploadPolicyError(
        "That sound is already attached to another gust",
        409
      );
    }
    throw error;
  }

  const derivatives = await prisma.mediaDerivative.findMany({
    select: { key: true },
    where: { mediaId: video.id },
  });
  if (derivatives.length === 0) {
    return { mediaId: video.id, reprocessing: false };
  }

  // Best-effort object cleanup mirrors the reprocess CLI: the row delete is
  // the source of truth, straggler objects are harmless orphans.
  await Promise.allSettled(
    derivatives.map((derivative) => deleteObject(derivative.key))
  );
  await prisma.mediaDerivative.deleteMany({ where: { mediaId: video.id } });
  await enqueueMediaProcess(video.id, {
    jobIdSuffix: `overlay-${Date.now()}`,
  });
  return { mediaId: video.id, reprocessing: true };
}

// Attaches (or clears) an author-uploaded cover image for a video (gust
// thumbnail). The image's published bytes are COPIED into the video's own
// key space, so the serving route can prefer them over the pipeline's
// scene-aware poster and the uploaded image row needs no special lifetime
// handling - it can be discarded like any draft. Passing null clears the
// custom thumbnail and falls serving back to the generated poster.
export async function attachCustomThumbnail(input: {
  mediaId: string;
  thumbnailMediaId: string | null;
  userId: string;
}): Promise<{ mediaId: string; attached: boolean }> {
  const { mediaId, thumbnailMediaId, userId } = input;
  const { deleteObject } = await import("@asm/db");
  const { isTerminalStatus } = await import("@asm/media");
  const { CopyObjectCommand } = await import("@aws-sdk/client-s3");

  const video = await prisma.media.findFirst({
    select: {
      customThumbnailKey: true,
      id: true,
      status: true,
      type: true,
    },
    where: { id: mediaId, userId },
  });
  if (
    !video ||
    video.type !== "VIDEO" ||
    isTerminalStatus(video.status) ||
    video.status === "FAILED"
  ) {
    throw new UploadPolicyError("Media not found", 404);
  }

  if (!thumbnailMediaId) {
    // Clear: drop the copied object (best-effort) and fall back to the
    // pipeline poster.
    if (video.customThumbnailKey) {
      await deleteObject(video.customThumbnailKey).catch(() => null);
    }
    await prisma.media.update({
      data: { customThumbnailKey: null },
      where: { id: video.id },
    });
    return { attached: false, mediaId: video.id };
  }

  const image = await prisma.media.findFirst({
    select: {
      id: true,
      mimeType: true,
      publishedKey: true,
      status: true,
      type: true,
      userId: true,
    },
    where: { id: thumbnailMediaId },
  });
  if (!image || image.userId !== userId || image.type !== "IMAGE") {
    throw new UploadPolicyError("Thumbnail image not found", 404);
  }
  // Serving streams these bytes for the video's lifetime; only verified,
  // published originals qualify.
  if (image.status !== "READY" || !image.publishedKey) {
    throw new UploadPolicyError("Thumbnail image is not ready yet", 409);
  }

  const extension = image.mimeType.includes("/")
    ? (image.mimeType.split("/")[1] ?? "jpg").replace("+xml", "")
    : "jpg";
  const thumbnailKey = `derived/${video.id}/custom-thumbnail.${extension}`;
  await getPresignClient().send(
    new CopyObjectCommand({
      Bucket: env.ASMOB_BUCKET_NAME,
      ContentType: image.mimeType,
      // CopySource is bucket/key encoded.
      CopySource: `/${env.ASMOB_BUCKET_NAME}/${image.publishedKey}`,
      Key: thumbnailKey,
      MetadataDirective: "REPLACE",
    })
  );

  if (video.customThumbnailKey && video.customThumbnailKey !== thumbnailKey) {
    await deleteObject(video.customThumbnailKey).catch(() => null);
  }
  await prisma.media.update({
    data: { customThumbnailKey: thumbnailKey },
    where: { id: video.id },
  });
  return { attached: true, mediaId: video.id };
}

export async function headStoredObject(key: string): Promise<{
  contentLength: number;
  contentType: string | undefined;
} | null> {
  try {
    const head = await getPresignClient().send(
      new HeadObjectCommand({
        Bucket: env.ASMOB_BUCKET_NAME,
        Key: key,
      })
    );
    return {
      contentLength: head.ContentLength ?? 0,
      contentType: head.ContentType,
    };
  } catch {
    return null;
  }
}

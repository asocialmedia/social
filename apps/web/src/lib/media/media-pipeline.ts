import {
  and,
  consumeRateLimit,
  cancelMediaCleanup,
  prisma,
  redis,
  toPrismaDateTime,
} from "@asm/db";
import {
  maxBytesForType,
  quarantineKey,
  resolveMediaLimits,
  sanitizeExtension,
} from "@asm/media";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import { env } from "../../../env";
import {
  multipartPartCount,
  MULTIPART_UPLOAD_PART_SIZE_BYTES,
  shouldUseMultipartUpload,
} from "./multipart-upload";
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
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        socketTimeout: 10_000,
      }),
    });
  }
  return presignClient;
}

// Internal storage client for server-side operations (HEAD, GET). This
// always points at ASMOB_ENDPOINT (the internal Docker network address)
// and never the public Cloudflare-fronted URL. Going through Cloudflare
// for server-to-server S3 requests causes SigV4 signature mismatches
// because CF rewrites headers that are part of the signed payload.
let internalClient: S3Client | null = null;

function getInternalClient(): S3Client {
  if (!internalClient) {
    const endpoint = env.ASMOB_ENDPOINT;
    internalClient = new S3Client({
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
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        socketTimeout: 10_000,
      }),
    });
  }
  return internalClient;
}

export interface InitiatedUpload {
  deduplicated?: boolean;
  extension: string;
  mediaId: string;
  multipartUpload?: {
    partSize: number;
    uploadId: string;
  };
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
  // Conversation a message attachment belongs to. Required when purpose is
  // "message" (the route verifies membership); stored on the row so the
  // serving route can admit the peer.
  messageConversationId?: string | null;
  purpose: string | null;
  sha256?: string | null;
  userId: string;
  // Natural image dimensions captured client-side. Stored so receivers can
  // reserve the bubble box before the bytes arrive (no scroll jump).
  width?: number | null;
  height?: number | null;
}): Promise<InitiatedUpload> {
  const {
    audioOverlayId,
    declaredMime,
    fileName,
    fileSize,
    messageConversationId,
    purpose,
    sha256,
    userId,
    width,
    height,
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

  // Audio overlay (gust sound) validation: only VIDEO uploads can carry an overlay,
  // and the overlay must be an owned, ready AUDIO upload that is not already attached.
  if (audioOverlayId) {
    if (mediaType !== "VIDEO") {
      throw new UploadPolicyError(
        "Audio overlays can only be applied to video uploads",
        400
      );
    }
    const overlay = await prisma.orm.public.PostMedia.select(
      "id",
      "status",
      "_type",
      "userId"
    )
      .where({ id: audioOverlayId })
      .first();
    if (!overlay || overlay.userId !== userId || overlay._type !== "AUDIO") {
      throw new UploadPolicyError("Sound track not found", 404);
    }
    if (overlay.status !== "READY") {
      throw new UploadPolicyError("Sound track is not ready yet", 409);
    }
    const alreadyAttached = await prisma.orm.public.PostMedia.select("id")
      .where({ audioOverlayId })
      .first();
    if (alreadyAttached) {
      throw new UploadPolicyError(
        "That sound is already attached to another gust",
        409
      );
    }
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
  const activeJobs = await prisma.orm.public.PostMedia.where((media) =>
    and(media.status.in(["SCANNING", "PROCESSING"]), media.userId.eq(userId))
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  if (activeJobs.count >= MEDIA_LIMITS.maxConcurrentProcessingPerUser) {
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
    const existing = await prisma.orm.public.PostMedia.where((media) =>
      and(
        media.sha256.eq(sha256),
        media.size.eq(fileSize),
        media.status.in([
          "READY",
          "PROCESSING",
          "SCANNING",
          "QUARANTINED",
          "DELETED",
        ]),
        media._type.eq(mediaType),
        media.userId.eq(userId)
      )
    )
      .include("users", (user) => user.select("id"))
      .include("usersUsers", (user) => user.select("id"))
      .include("communities", (community) => community.select("id"))
      .include("communitiesCommunities", (community) => community.select("id"))
      .orderBy((media) => media.createdAt.desc())
      .first();

    if (existing) {
      const isUnattached =
        !existing.postId &&
        !existing.commentId &&
        !existing.messageConversationId &&
        existing.users.length === 0 &&
        existing.usersUsers.length === 0 &&
        existing.communities.length === 0 &&
        existing.communitiesCommunities.length === 0;
      // A different audio overlay means the row's stored (or in-flight) bytes
      // were baked with another track; reusing them would serve the wrong
      // audio. Computed once here and required by EVERY reuse path below - the
      // READY clone/reuse, the DELETED revival, and the in-flight re-attach -
      // so a mismatched overlay always falls through to fresh processing.
      const overlayMatches =
        (existing.audioOverlayId ?? null) === (audioOverlayId ?? null);

      // Fast path 1: Existing row reached READY and publishedKey exists
      if (existing.status === "READY" && existing.publishedKey) {
        // Same image re-sent to the same thread: reuse the row (and refresh
        // dimensions) instead of cloning per send. A row linked to a
        // *different* conversation is "attached" by the check above, so it
        // falls through to the clone path with the new conversation link.
        if (
          overlayMatches &&
          messageConversationId &&
          existing.messageConversationId === messageConversationId
        ) {
          if (width ?? height) {
            try {
              await prisma.orm.public.PostMedia.where({
                id: existing.id,
              }).update({
                ...(width ? { width } : {}),
                ...(height ? { height } : {}),
              });
            } catch (error) {
              console.error("Failed to refresh media dimensions:", error);
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
        if (overlayMatches && isUnattached) {
          // A message upload must never receive an unlinked row: the sender
          // (owner) would render it while the peer fails the
          // conversation-access check on every fetch — a permanently
          // one-sided message with no working retry. Claim the draft for this
          // thread with the same conditional update as the in-flight path; on
          // a lost claim fall through so a fresh linked row is created below
          // instead of handing back an id the peer cannot fetch.
          if (messageConversationId) {
            let claimed = false;
            try {
              let result = await prisma.orm.public.PostMedia.where((media) =>
                and(
                  media.id.eq(existing.id),
                  media.messageConversationId.isNull(),
                  media.status.eq("READY")
                )
              ).updateAndCount({
                messageConversationId,
                ...(width ? { width } : {}),
                ...(height ? { height } : {}),
              });
              if (result === 0) {
                result = await prisma.orm.public.PostMedia.where((media) =>
                  and(
                    media.id.eq(existing.id),
                    media.messageConversationId.eq(messageConversationId),
                    media.status.eq("READY")
                  )
                ).updateAndCount({
                  messageConversationId,
                  ...(width ? { width } : {}),
                  ...(height ? { height } : {}),
                });
              }
              claimed = result > 0;
            } catch (error) {
              console.error("Failed to link deduplicated media:", error);
            }
            if (claimed) {
              return {
                deduplicated: true,
                extension: sanitizeExtension(extensionGuess),
                mediaId: existing.id,
                status: "READY",
                uploadUrl: null,
              };
            }
          } else {
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
        }

        // Fast path 2: Existing row is attached to another post/comment (or
        // was baked with a different audio overlay). Clone the media record
        // referencing the same published objects. Row + derivatives commit
        // atomically: a failure between the two writes would otherwise leave
        // a READY clone with no playable variants.
        if (overlayMatches) {
          const cloned = await prisma.transaction(async (tx) => {
            let created: { id: string };
            try {
              created = await tx.orm.public.PostMedia.select("id").create({
                _type: existing._type,
                aiGenerated: existing.aiGenerated,
                aiProvenance: existing.aiProvenance ?? null,
                blurDataUrl: existing.blurDataUrl,
                captionsKey: existing.captionsKey,
                claimedMime: existing.claimedMime,
                customThumbnailKey: null,
                detectedMime: existing.detectedMime,
                encoderVersion: existing.encoderVersion,
                exifStripped: existing.exifStripped,
                hasHls: existing.hasHls,
                height: height ?? existing.height ?? null,
                key: existing.key,
                messageConversationId: messageConversationId ?? null,
                mimeType: existing.mimeType,
                originalName: sanitizeDisplayName(fileName),
                pipelineVersion: existing.pipelineVersion,
                platform: existing.platform,
                processedAt: toPrismaDateTime(new Date()),
                publishedKey: existing.publishedKey,
                semanticTags: existing.semanticTags,
                sha256: existing.sha256,
                size: existing.size,
                status: "READY",
                techMetadata: existing.techMetadata ?? null,
                thumbnailHeight: existing.thumbnailHeight,
                thumbnailKey: existing.thumbnailKey,
                thumbnailWidth: existing.thumbnailWidth,
                transcript: existing.transcript,
                uploaderDisplayName: existing.uploaderDisplayName,
                uploaderUsername: existing.uploaderUsername,
                url: existing.url,
                userId,
                width: width ?? existing.width ?? null,
                ...(audioOverlayId ? { audioOverlayId } : {}),
              });
            } catch (error: unknown) {
              if ((error as { code?: string }).code === "P2002") {
                throw new UploadPolicyError(
                  "That sound is already attached to another gust",
                  409
                );
              }
              throw error;
            }

            // Mirror any pre-computed derivative variants
            const existingDerivatives =
              await tx.orm.public.PostMediaDerivatives.where((derivative) =>
                derivative.mediaId.eq(existing.id)
              ).all();
            if (existingDerivatives.length > 0) {
              await Promise.all(
                existingDerivatives.map((derivative) =>
                  tx.orm.public.PostMediaDerivatives.create({
                    durationMs: derivative.durationMs,
                    height: derivative.height,
                    key: derivative.key,
                    kind: derivative.kind,
                    mediaId: created.id,
                    mimeType: derivative.mimeType,
                    pipelineVersion: derivative.pipelineVersion,
                    sizeBytes: derivative.sizeBytes,
                    variant: derivative.variant,
                    width: derivative.width,
                  })
                )
              );
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
        overlayMatches &&
        existing.status === "DELETED" &&
        existing.publishedKey &&
        isUnattached
      ) {
        try {
          await cancelMediaCleanup(existing.id);
        } catch (error) {
          console.error("Failed to cancel pending media cleanup:", error);
        }
        await prisma.orm.public.PostMedia.where({ id: existing.id }).update({
          failureCode: null,
          failureDetail: null,
          originalName: sanitizeDisplayName(fileName),
          rejectedReason: null,
          status: "READY",
          ...(audioOverlayId ? { audioOverlayId } : {}),
          ...(messageConversationId ? { messageConversationId } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
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
        overlayMatches &&
        isUnattached &&
        (existing.status === "SCANNING" ||
          existing.status === "PROCESSING" ||
          existing.status === "QUARANTINED")
      ) {
        // Bind the in-flight row to this thread so the peer can fetch it
        // once the pipeline publishes. Post drafts bind via postId later,
        // which takes precedence in the access decision.
        //
        // The claim is a conditional update, not a blind write: two concurrent
        // sends of the same file to different conversations can both read this
        // row as unattached, and an unconditional update would let the last
        // writer silently steal recipient access from the first. Only a row
        // that is still unattached (or already ours) can be claimed. When the
        // claim affects no row, another conversation won it, or the update
        // failed: either way we must NOT hand back this mediaId, because the
        // peer would fail the conversation-access check. Fall through and let
        // a fresh row be created for this conversation instead.
        let claimed = !messageConversationId;
        if (messageConversationId) {
          try {
            let result = await prisma.orm.public.PostMedia.where((media) =>
              and(
                media.id.eq(existing.id),
                media.messageConversationId.isNull()
              )
            ).updateAndCount({
              messageConversationId,
              ...(width ? { width } : {}),
              ...(height ? { height } : {}),
            });
            if (result === 0) {
              result = await prisma.orm.public.PostMedia.where((media) =>
                and(
                  media.id.eq(existing.id),
                  media.messageConversationId.eq(messageConversationId)
                )
              ).updateAndCount({
                messageConversationId,
                ...(width ? { width } : {}),
                ...(height ? { height } : {}),
              });
            }
            claimed = result > 0;
          } catch (error) {
            console.error("Failed to link in-flight media:", error);
            claimed = false;
          }
        }
        if (claimed) {
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
  }

  let media;
  try {
    media = await prisma.orm.public.PostMedia.select("id").create({
      _type: mediaType,
      claimedMime: declaredMime.toLowerCase(),
      key: "",
      mimeType: declaredMime.toLowerCase(),
      originalName: sanitizeDisplayName(fileName),
      sha256: sha256 ?? null,
      size: fileSize,
      status: "UPLOADING",
      url: "",
      userId,
      ...(audioOverlayId ? { audioOverlayId } : {}),
      ...(messageConversationId ? { messageConversationId } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "P2002") {
      throw new UploadPolicyError(
        "That sound is already attached to another gust",
        409
      );
    }
    throw error;
  }

  // The quarantine key embeds the generated id, so patch the row once with
  // its final key. Keys stay deterministic and content-free.
  const originalKey = quarantineKey(media.id, extensionGuess);
  await prisma.orm.public.PostMedia.where({ id: media.id }).update({
    originalKey,
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

  if (shouldUseMultipartUpload(fileSize)) {
    const multipart = await getInternalClient().send(
      new CreateMultipartUploadCommand({
        Bucket: env.ASMOB_BUCKET_NAME,
        ContentType: declaredMime,
        Key: originalKey,
      })
    );
    if (!multipart.UploadId) {
      throw new Error("Storage did not return a multipart upload id");
    }
    return {
      extension: sanitizeExtension(extensionGuess),
      mediaId: media.id,
      multipartUpload: {
        partSize: MULTIPART_UPLOAD_PART_SIZE_BYTES,
        uploadId: multipart.UploadId,
      },
      uploadUrl: null,
    };
  }

  const uploadUrl = await getSignedUrl(
    getPresignClient(),
    new PutObjectCommand({
      Bucket: env.ASMOB_BUCKET_NAME,
      ContentType: declaredMime,
      Key: originalKey,
    }),
    { expiresIn: 900 }
  );

  return {
    extension: sanitizeExtension(extensionGuess),
    mediaId: media.id,
    uploadUrl,
  };
}

export function createMultipartPartUploadUrl(input: {
  key: string;
  partNumber: number;
  uploadId: string;
}): Promise<string> {
  return getSignedUrl(
    getPresignClient(),
    new UploadPartCommand({
      Bucket: env.ASMOB_BUCKET_NAME,
      Key: input.key,
      PartNumber: input.partNumber,
      UploadId: input.uploadId,
    }),
    { expiresIn: 900 }
  );
}

// CompleteMultipartUpload assembles the object server-side and can sit idle
// past the 10s socket timeout of the shared internal client on large uploads.
// A dedicated client with a longer idle budget keeps storage-side assembly
// from being aborted client-side.
let completionClient: S3Client | null = null;

function getCompletionClient(): S3Client {
  if (!completionClient) {
    const endpoint = env.ASMOB_ENDPOINT;
    completionClient = new S3Client({
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
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        socketTimeout: 120_000,
      }),
    });
  }
  return completionClient;
}

export async function completeMultipartStoredUpload(input: {
  key: string;
  parts: { eTag: string; partNumber: number }[];
  uploadId: string;
}): Promise<void> {
  await getCompletionClient().send(
    new CompleteMultipartUploadCommand({
      Bucket: env.ASMOB_BUCKET_NAME,
      Key: input.key,
      MultipartUpload: {
        Parts: input.parts.map((part) => ({
          ETag: part.eTag,
          PartNumber: part.partNumber,
        })),
      },
      UploadId: input.uploadId,
    })
  );
}

export function expectedMultipartPartCount(fileSize: number): number {
  return multipartPartCount(fileSize);
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

  const video = await prisma.orm.public.PostMedia.select(
    "id",
    "status",
    "_type"
  )
    .where((media) => and(media.id.eq(mediaId), media.userId.eq(userId)))
    .first();
  if (
    !video ||
    video._type !== "VIDEO" ||
    isTerminalStatus(video.status) ||
    video.status === "FAILED"
  ) {
    throw new UploadPolicyError("Media not found", 404);
  }

  if (audioOverlayId) {
    const overlay = await prisma.orm.public.PostMedia.select(
      "id",
      "status",
      "_type",
      "userId"
    )
      .where({ id: audioOverlayId })
      .first();
    if (!overlay || overlay.userId !== userId || overlay._type !== "AUDIO") {
      throw new UploadPolicyError("Sound track not found", 404);
    }
    // The process stage streams the track's published bytes; a row that is
    // not READY has no verified bytes to remux.
    if (overlay.status !== "READY") {
      throw new UploadPolicyError("Sound track is not ready yet", 409);
    }
  }

  try {
    await prisma.orm.public.PostMedia.where({ id: video.id }).update({
      audioOverlayId,
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

  const derivatives = await prisma.orm.public.PostMediaDerivatives.select("key")
    .where({ mediaId: video.id })
    .all();
  if (derivatives.length === 0) {
    return { mediaId: video.id, reprocessing: false };
  }

  // Best-effort object cleanup mirrors the reprocess CLI: the row delete is
  // the source of truth, straggler objects are harmless orphans.
  await Promise.allSettled(
    derivatives.map((derivative) => deleteObject(derivative.key))
  );
  await prisma.orm.public.PostMediaDerivatives.where({
    mediaId: video.id,
  }).delete();
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

  const video = await prisma.orm.public.PostMedia.select(
    "customThumbnailKey",
    "id",
    "status",
    "_type"
  )
    .where((media) => and(media.id.eq(mediaId), media.userId.eq(userId)))
    .first();
  if (
    !video ||
    video._type !== "VIDEO" ||
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
    await prisma.orm.public.PostMedia.where({ id: video.id }).update({
      customThumbnailKey: null,
    });
    return { attached: false, mediaId: video.id };
  }

  const image = await prisma.orm.public.PostMedia.select(
    "id",
    "mimeType",
    "publishedKey",
    "status",
    "_type",
    "userId"
  )
    .where({ id: thumbnailMediaId })
    .first();
  if (!image || image.userId !== userId || image._type !== "IMAGE") {
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
  await prisma.orm.public.PostMedia.where({ id: video.id }).update({
    customThumbnailKey: thumbnailKey,
  });
  return { attached: true, mediaId: video.id };
}

export async function headStoredObject(key: string): Promise<{
  contentLength: number;
  contentType: string | undefined;
} | null> {
  // Use the internal client (ASMOB_ENDPOINT) for server-side checks, not the
  // presign client (ASMOB_PUBLIC_ENDPOINT). Cloudflare rewrites headers on the
  // public URL, breaking SigV4 signatures for server-to-server requests.
  const client = getInternalClient();
  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: env.ASMOB_BUCKET_NAME,
        Key: key,
      })
    );
    return {
      contentLength: head.ContentLength ?? 0,
      contentType: head.ContentType,
    };
  } catch (headError) {
    // If HEAD failed, attempt a range GET fallback before declaring the object missing
    try {
      const getRes = await client.send(
        new GetObjectCommand({
          Bucket: env.ASMOB_BUCKET_NAME,
          Key: key,
          Range: "bytes=0-0",
        })
      );
      if (
        getRes.Body &&
        typeof (getRes.Body as { destroy?: () => void }).destroy === "function"
      ) {
        (getRes.Body as { destroy: () => void }).destroy();
      }
      let totalLength = getRes.ContentLength ?? 0;
      if (getRes.ContentRange) {
        const parts = getRes.ContentRange.split("/");
        if (parts[1] && !Number.isNaN(Number(parts[1]))) {
          totalLength = Number(parts[1]);
        }
      }
      return {
        contentLength: totalLength,
        contentType: getRes.ContentType,
      };
    } catch (getError) {
      console.error("[media-pipeline] headStoredObject failed:", {
        bucket: env.ASMOB_BUCKET_NAME,
        getError: getError instanceof Error ? getError.message : getError,
        headError: headError instanceof Error ? headError.message : headError,
        key,
      });
      return null;
    }
  }
}

import { consumeRateLimit, prisma, redis } from "@asm/db";
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
  extension: string;
  mediaId: string;
  uploadUrl: string;
}

export async function createInitiatedUpload(input: {
  /** When set (gust sound), the uploaded AUDIO media id whose track replaces
   * the video's own audio during pipeline processing. */
  audioOverlayId?: string | null;
  declaredMime: string;
  fileName: string;
  fileSize: number;
  purpose: string | null;
  userId: string;
}): Promise<InitiatedUpload> {
  const { audioOverlayId, declaredMime, fileName, fileSize, purpose, userId } =
    input;

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

  const media = await prisma.media.create({
    data: {
      // New-flow rows carry no legacy URL/key; serving falls back to the
      // pipeline's publishedKey + derivatives instead.
      claimedMime: declaredMime.toLowerCase(),
      key: "",
      mimeType: declaredMime.toLowerCase(),
      originalName: sanitizeDisplayName(fileName),
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

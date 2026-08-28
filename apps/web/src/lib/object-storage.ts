import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import { env } from "../../env";

const asmobEndpoint = env.ASMOB_ENDPOINT;

// Ensures the object-storage endpoint carries a protocol. The endpoint may be
// configured without one, which makes the AWS SDK fail with ERR_INVALID_URL
// when it builds the request URL. Normalize to https so a bare hostname works.
function normalizeEndpoint(endpoint: string | undefined): string {
  if (!endpoint) {
    return endpoint as string;
  }
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
}

export const asmobClient = new S3Client({
  credentials: {
    accessKeyId: env.ASMOB_ROOT_USER,
    secretAccessKey: env.ASMOB_ROOT_PASSWORD,
  },
  endpoint: normalizeEndpoint(asmobEndpoint),
  forcePathStyle: true,
  maxAttempts: 3,
  region: "ap-south-1",
  requestHandler:
    typeof window === "undefined"
      ? new NodeHttpHandler({
          connectionTimeout: 5000,
          // Generous so long-lived streams survive slow consumers: the media
          // proxy pipes object bodies straight to clients, and when a client
          // on a slow network backpressures the stream the storage socket can
          // sit idle for a while. A tight timeout would abort the download
          // mid-stream. Buffered requests are unaffected.
          socketTimeout: 30_000,
        })
      : new FetchHttpHandler({
          requestTimeout: 5000,
        }),
});

export const ASMOB_BUCKET = env.ASMOB_BUCKET_NAME;

const presignedUrlCache = new Map<string, { expiresAt: number; url: string }>();

export const generatePresignedUrl = async (key: string) => {
  const now = Date.now();
  const cached = presignedUrlCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.url;
  }

  const command = new GetObjectCommand({
    Bucket: ASMOB_BUCKET,
    Key: key,
  });

  const url = await getSignedUrl(asmobClient, command, { expiresIn: 3600 });
  // Cache for 50 minutes (well before the 60m expiry window)
  presignedUrlCache.set(key, { expiresAt: now + 50 * 60 * 1000, url });

  // Opportunistic cleanup of expired keys if cache grows large
  if (presignedUrlCache.size > 200) {
    for (const [k, v] of presignedUrlCache) {
      if (v.expiresAt <= now) {
        presignedUrlCache.delete(k);
      }
    }
  }

  return url;
};

export const deleteAvatar = async (key: string) => {
  if (!key) {
    throw new Error("Avatar key is required");
  }

  try {
    console.log("Starting avatar deletion:", { key });

    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

    await asmobClient.send(
      new DeleteObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: key,
      })
    );

    console.log("Avatar deleted successfully:", { key });
    return true;
  } catch (error) {
    console.error("Failed to delete avatar:", error);

    console.error("Detailed avatar deletion error:", {
      error,
      key,
    });

    const errorMessage =
      error instanceof Error ? error.message : "Failed to remove avatar";

    throw new Error(`Failed to delete avatar: ${errorMessage}`, {
      cause: error,
    });
  }
};

export const deleteBanner = async (key: string) => {
  if (!key) {
    throw new Error("Banner key is required");
  }

  try {
    console.log("Starting banner deletion:", { key });

    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

    await asmobClient.send(
      new DeleteObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: key,
      })
    );

    console.log("Banner deleted successfully:", { key });
    return true;
  } catch (error) {
    console.error("Failed to delete banner:", error);

    console.error("Detailed banner deletion error:", {
      error,
      key,
    });

    const errorMessage =
      error instanceof Error ? error.message : "Failed to remove banner";

    throw new Error(`Failed to delete banner: ${errorMessage}`, {
      cause: error,
    });
  }
};

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import { env } from "../../env";
import { sniffFileSignature } from "./utils/magic-bytes";

// Client-fixable upload rejections (type, size, content signature). Routes
// map this to a 4xx response instead of a 500 so the browser shows the
// validation message rather than a server error.
export class UploadValidationError extends Error {
  override name = "UploadValidationError";
}

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

export const getPublicUrl = (key: string) => {
  if (!key) {
    throw new Error("File key is required");
  }

  const finalEndpoint = normalizeEndpoint(
    asmobEndpoint || "http://localhost:9090"
  );

  return `${finalEndpoint}/${ASMOB_BUCKET}/${encodeURIComponent(key)}`;
};

export const validateBucket = async () => {
  try {
    const { HeadBucketCommand } = await import("@aws-sdk/client-s3");

    await asmobClient.send(
      new HeadBucketCommand({
        Bucket: ASMOB_BUCKET,
      })
    );
    return true;
  } catch (error) {
    if (
      (error as { name: string }).name === "NotFound" ||
      (error as { Code: string }).Code === "NoSuchBucket" ||
      (error as { $metadata?: { httpStatusCode: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      console.warn(`Bucket "${ASMOB_BUCKET}" does not exist`);
      return false;
    }
    console.error("Error validating bucket:", error);
    throw new Error(`Failed to validate bucket: ${(error as Error).message}`, {
      cause: error,
    });
  }
};

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

export const checkFileExists = async (key: string) => {
  try {
    const command = new GetObjectCommand({
      Bucket: ASMOB_BUCKET,
      Key: key,
    });
    await asmobClient.send(command);
    return true;
  } catch {
    return false;
  }
};

export const uploadAvatar = async (file: File, userId: string) => {
  if (!(file && userId)) {
    throw new Error("File and userId are required");
  }

  try {
    const supportedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/heic",
    ];

    console.log("Avatar upload started:", {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });

    if (!supportedTypes.includes(file.type)) {
      throw new UploadValidationError(
        "Avatar must be in JPG, PNG, GIF, WebP, or HEIC format"
      );
    }

    const maxSize = 8 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new UploadValidationError("Avatar file size must be less than 8MB");
    }

    const cleanFileName = file.name.replaceAll(/[^a-zA-Z0-9.-]/g, "_");
    const uniquePrefix = `${Date.now()}-${crypto.randomUUID()}`;
    const key = `avatars/${userId}/${uniquePrefix}-${cleanFileName}`;

    let buffer: Buffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      console.error("Buffer conversion error:", error);
      throw new Error("Failed to process avatar image", { cause: error });
    }

    // The client-declared MIME string is untrusted: verify the bytes actually
    // match an image signature before storing, otherwise a crafted HTML
    // payload could later MIME-sniff into script execution on the app origin.
    const signature = sniffFileSignature(buffer, file.type);
    if (!signature.ok) {
      throw new UploadValidationError(
        signature.reason ?? "File content validation failed"
      );
    }

    await asmobClient.send(
      new PutObjectCommand({
        Body: buffer,
        Bucket: ASMOB_BUCKET,
        CacheControl: "public, max-age=31536000",
        ContentType: file.type,
        Key: key,
        Metadata: {
          category: "AVATAR",
          fileType: file.name.split(".").pop()?.toLowerCase() || "",
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          userId,
        },
      })
    );

    const url = getPublicUrl(key);

    console.log("Avatar upload successful:", {
      key,
      size: file.size,
      url,
    });

    return {
      key,
      mimeType: file.type,
      originalName: file.name,
      size: file.size,
      type: "IMAGE",
      url,
    };
  } catch (error) {
    console.error("Avatar upload error:", error);

    console.error("Detailed avatar upload error:", {
      error,
      file: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
      userId,
    });

    throw error;
  }
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

export const uploadBanner = async (file: File, userId: string) => {
  if (!(file && userId)) {
    throw new Error("File and userId are required");
  }

  try {
    const supportedTypes = ["image/jpeg", "image/png", "image/webp"];

    console.log("Banner upload started:", {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });

    if (!supportedTypes.includes(file.type)) {
      throw new UploadValidationError(
        "Banner must be in JPG, PNG, or WebP format"
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new UploadValidationError(
        "Banner file size must be less than 10MB"
      );
    }

    const cleanFileName = file.name.replaceAll(/[^a-zA-Z0-9.-]/g, "_");
    const uniquePrefix = `${Date.now()}-${crypto.randomUUID()}`;
    const key = `banners/${userId}/${uniquePrefix}-${cleanFileName}`;

    let buffer: Buffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      console.error("Buffer conversion error:", error);
      throw new Error("Failed to process banner image", { cause: error });
    }

    // The client-declared MIME string is untrusted: verify the bytes actually
    // match an image signature before storing, otherwise a crafted HTML
    // payload could later MIME-sniff into script execution on the app origin.
    const signature = sniffFileSignature(buffer, file.type);
    if (!signature.ok) {
      throw new UploadValidationError(
        signature.reason ?? "File content validation failed"
      );
    }

    await asmobClient.send(
      new PutObjectCommand({
        Body: buffer,
        Bucket: ASMOB_BUCKET,
        CacheControl: "public, max-age=31536000",
        ContentType: file.type,
        Key: key,
        Metadata: {
          category: "BANNER",
          fileType: file.name.split(".").pop()?.toLowerCase() || "",
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          userId,
        },
      })
    );

    const url = getPublicUrl(key);

    console.log("Banner upload successful:", {
      key,
      size: file.size,
      url,
    });

    return {
      key,
      mimeType: file.type,
      originalName: file.name,
      size: file.size,
      type: "IMAGE",
      url,
    };
  } catch (error) {
    console.error("Banner upload error:", error);

    console.error("Detailed banner upload error:", {
      error,
      file: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
      userId,
    });

    throw error;
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

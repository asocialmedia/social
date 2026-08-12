import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { env } from "../../env";
import { validateFile } from "./utils/file-validation";
import { getContentType, getFileConfigFromMime } from "./utils/mime-utils";

const asmobLocalEndpoint = env.ASMOB_ENDPOINT;

export const asmobClient = new S3Client({
  credentials: {
    accessKeyId: env.ASMOB_ROOT_USER,
    secretAccessKey: env.ASMOB_ROOT_PASSWORD,
  },
  endpoint:
    env.NODE_ENV === "production"
      ? env.ASMOB_PRODUCTION_ENDPOINT || "rustfs.asocialmedia.cc"
      : asmobLocalEndpoint,
  forcePathStyle: true,
  maxAttempts: 3,
  region: "ap-south-1",
  requestHandler:
    typeof window === "undefined"
      ? new NodeHttpHandler({
          connectionTimeout: 5000,
          socketTimeout: 5000,
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

  const endpoint = env.ASMOB_ENDPOINT ?? asmobLocalEndpoint;

  const productionEndpoint =
    env.ASMOB_PRODUCTION_ENDPOINT || "rustfs.asocialmedia.cc";

  const finalEndpoint =
    env.NODE_ENV === "production"
      ? productionEndpoint
      : endpoint || "http://localhost:9090";

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

export const generatePresignedUrl = async (key: string) => {
  const command = new GetObjectCommand({
    Bucket: ASMOB_BUCKET,
    Key: key,
  });

  return await getSignedUrl(asmobClient, command, { expiresIn: 3600 });
};

export const uploadToAsmob = async (file: File, userId: string) => {
  if (!(file && userId)) {
    throw new Error("File and userId are required");
  }

  try {
    console.log("Starting upload:", {
      name: file.name,
      size: file.size,
      type: file.type,
    });

    validateFile(file);

    const bucketOk = await validateBucket();
    if (!bucketOk) {
      throw new Error(`Object storage bucket "${ASMOB_BUCKET}" does not exist`);
    }

    const fileConfig = getFileConfigFromMime(file.type);
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniquePrefix = `${Date.now()}-${crypto.randomUUID()}`;
    const key = `${userId}/${uniquePrefix}-${cleanFileName}`;
    const extension = file.name.split(".").pop()?.toLowerCase() || "";

    let buffer: Buffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      console.error("Buffer conversion error:", error);
      throw new Error("Failed to process file data", { cause: error });
    }

    await asmobClient.send(
      new PutObjectCommand({
        Body: buffer,
        Bucket: ASMOB_BUCKET,
        ContentType: getContentType(file.name),
        Key: key,
        Metadata: {
          category: fileConfig?.category || "DOCUMENT",
          fileType: extension,
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          userId,
        },
      })
    );

    const url = getPublicUrl(key);

    return {
      extension,
      key,
      mimeType: file.type,
      originalName: file.name,
      size: file.size,
      tag: fileConfig?.tag,
      type: fileConfig?.category || "DOCUMENT",
      url,
    };
  } catch (error) {
    console.error("Object storage upload error:", error);
    throw error;
  }
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
      throw new Error("Avatar must be in JPG, PNG, GIF, WebP, or HEIC format");
    }

    const maxSize = 8 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error("Avatar file size must be less than 8MB");
    }

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
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
      throw new Error("Banner must be in JPG, PNG, or WebP format");
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error("Banner file size must be less than 10MB");
    }

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
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

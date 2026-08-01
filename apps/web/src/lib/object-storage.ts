import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { toast } from "sonner";
import { env } from "../../env";
import { validateFile } from "./utils/file-validation";
import { getContentType, getFileConfigFromMime } from "./utils/mime-utils";
import { uploadToasts } from "./utils/upload-messages";

const isClient = typeof window !== "undefined";

const zephobLocalEndpoint = env.ZEPHOB_ENDPOINT;

export const zephobClient = new S3Client({
  region: "ap-south-1",
  endpoint:
    env.NODE_ENV === "production"
      ? env.ZEPHOB_PRODUCTION_ENDPOINT || "rustfs.asocialmedia.cc"
      : zephobLocalEndpoint,
  credentials: {
    accessKeyId: env.ZEPHOB_ROOT_USER,
    secretAccessKey: env.ZEPHOB_ROOT_PASSWORD,
  },
  forcePathStyle: true,
  maxAttempts: 3,
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

export const ZEPHOB_BUCKET = env.ZEPHOB_BUCKET_NAME;

export const getPublicUrl = (key: string) => {
  if (!key) {
    throw new Error("File key is required");
  }

  const endpoint = env.ZEPHOB_ENDPOINT ?? zephobLocalEndpoint;

  const productionEndpoint =
    env.ZEPHOB_PRODUCTION_ENDPOINT || "rustfs.asocialmedia.cc";

  const finalEndpoint =
    env.NODE_ENV === "production"
      ? productionEndpoint
      : endpoint || "http://localhost:9090";

  return `${finalEndpoint}/${ZEPHOB_BUCKET}/${encodeURIComponent(key)}`;
};

export const validateBucket = async () => {
  try {
    const { HeadBucketCommand } = await import("@aws-sdk/client-s3");

    await zephobClient.send(
      new HeadBucketCommand({
        Bucket: ZEPHOB_BUCKET,
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
      console.warn(`Bucket "${ZEPHOB_BUCKET}" does not exist`);
      return false;
    }
    console.error("Error validating bucket:", error);
    throw new Error(`Failed to validate bucket: ${(error as Error).message}`);
  }
};

export const generatePresignedUrl = async (key: string) => {
  const command = new GetObjectCommand({
    Bucket: ZEPHOB_BUCKET,
    Key: key,
  });

  return await getSignedUrl(zephobClient, command, { expiresIn: 3600 });
};

export const uploadToZephob = async (file: File, userId: string) => {
  if (!(file && userId)) {
    throw new Error("File and userId are required");
  }

  const toastId = isClient
    ? toast.loading(uploadToasts.started(file.name).description)
    : undefined;

  try {
    console.log("Starting upload:", {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    validateFile(file);

    const bucketOk = await validateBucket();
    if (!bucketOk) {
      throw new Error(
        `Object storage bucket "${ZEPHOB_BUCKET}" does not exist`
      );
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
      throw new Error("Failed to process file data");
    }

    await zephobClient.send(
      new PutObjectCommand({
        Bucket: ZEPHOB_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: getContentType(file.name),
        Metadata: {
          userId,
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          category: fileConfig?.category || "DOCUMENT",
          fileType: extension,
        },
      })
    );

    const url = getPublicUrl(key);

    if (isClient && toastId) {
      toast.success(
        uploadToasts.success(file.name, fileConfig?.category || "DOCUMENT")
          .description,
        { id: toastId }
      );
    }

    return {
      key,
      url,
      type: fileConfig?.category || "DOCUMENT",
      mimeType: file.type,
      size: file.size,
      originalName: file.name,
      extension,
      tag: fileConfig?.tag,
    };
  } catch (error) {
    console.error("Object storage upload error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to upload file";

    if (isClient && toastId) {
      toast.error(uploadToasts.error(errorMessage).description, {
        id: toastId,
      });
    }
    throw error;
  }
};

export const checkFileExists = async (key: string) => {
  try {
    const command = new GetObjectCommand({
      Bucket: ZEPHOB_BUCKET,
      Key: key,
    });
    await zephobClient.send(command);
    return true;
  } catch {
    return false;
  }
};

export const uploadAvatar = async (file: File, userId: string) => {
  if (!(file && userId)) {
    throw new Error("File and userId are required");
  }

  const toastId = isClient
    ? toast.loading("Updating profile picture...")
    : undefined;

  try {
    const supportedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/heic",
    ];

    console.log("Avatar upload started:", {
      fileType: file.type,
      fileName: file.name,
      fileSize: file.size,
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
      throw new Error("Failed to process avatar image");
    }

    await zephobClient.send(
      new PutObjectCommand({
        Bucket: ZEPHOB_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        Metadata: {
          userId,
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          category: "AVATAR",
          fileType: file.name.split(".").pop()?.toLowerCase() || "",
        },
        CacheControl: "public, max-age=31536000",
      })
    );

    const url = getPublicUrl(key);

    if (isClient && toastId) {
      toast.success(uploadToasts.avatarSuccess().description, {
        id: toastId,
      });
    }

    console.log("Avatar upload successful:", {
      key,
      url,
      size: file.size,
    });

    return {
      key,
      url,
      type: "IMAGE",
      mimeType: file.type,
      size: file.size,
      originalName: file.name,
    };
  } catch (error) {
    console.error("Avatar upload error:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to update profile picture";

    if (isClient && toastId) {
      toast.error(uploadToasts.avatarError(errorMessage).description, {
        id: toastId,
      });
    }

    console.error("Detailed avatar upload error:", {
      error,
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
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

  const toastId = isClient
    ? toast.loading("Removing profile picture...")
    : undefined;

  try {
    console.log("Starting avatar deletion:", { key });

    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

    await zephobClient.send(
      new DeleteObjectCommand({
        Bucket: ZEPHOB_BUCKET,
        Key: key,
      })
    );

    if (isClient && toastId) {
      toast.success("Profile picture removed successfully", {
        id: toastId,
      });
    }

    console.log("Avatar deleted successfully:", { key });
    return true;
  } catch (error) {
    console.error("Failed to delete avatar:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to remove profile picture";

    if (isClient && toastId) {
      toast.error(uploadToasts.error(errorMessage).description, {
        id: toastId,
      });
    }

    console.error("Detailed avatar deletion error:", {
      error,
      key,
    });

    throw new Error(`Failed to delete avatar: ${errorMessage}`);
  }
};

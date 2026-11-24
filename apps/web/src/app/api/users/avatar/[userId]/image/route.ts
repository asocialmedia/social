import { avatarCache, prisma } from "@asm/db";
import { isStorageBucketMissing } from "@asm/media";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";
import { retryProfileObjectRead } from "@/lib/media/profile-object-read";
import { getDefaultAvatar } from "@/lib/utils/image-url";

const IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

function inferMimeFromKey(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": {
      return "image/png";
    }
    case "jpg":
    case "jpeg": {
      return "image/jpeg";
    }
    case "webp": {
      return "image/webp";
    }
    case "gif": {
      return "image/gif";
    }
    case "svg": {
      return "image/svg+xml";
    }
    case "avif": {
      return "image/avif";
    }
    case "heic": {
      return "image/heic";
    }
    default: {
      return null;
    }
  }
}

// Avatars live in the private ASMOB bucket (key prefix `avatars/{userId}/...`)
// and are streamed through this app route so content is only reachable via the
// app, never directly from object storage.
export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const { userId } = await context.params;

  let avatarKey: string | null = null;
  try {
    const cached = await avatarCache.get(userId).catch(() => null);
    if (cached?.key) {
      avatarKey = cached.key;
    }
    if (!avatarKey) {
      const user = await prisma.orm.public.Users.select("avatarKey")
        .where({ id: userId })
        .first();
      avatarKey = user?.avatarKey ?? null;
    }
  } catch {
    // Cache or DB outage: fall through to the default avatar instead of 500.
    avatarKey = null;
  }

  if (!avatarKey) {
    const fallbackPath = getDefaultAvatar(userId);
    return NextResponse.redirect(new URL(fallbackPath, request.url), 307);
  }

  try {
    const command = new GetObjectCommand({
      Bucket: ASMOB_BUCKET,
      Key: avatarKey,
    });
    const response = await retryProfileObjectRead(
      () => asmobClient.send(command, { abortSignal: request.signal }),
      request.signal
    );

    if (!response.Body || response.ContentLength === 0) {
      const fallbackPath = getDefaultAvatar(userId);
      return NextResponse.redirect(new URL(fallbackPath, request.url), 307);
    }

    const headers = new Headers();
    // Serve only a fixed image allowlist. A legacy or crafted object whose
    // stored type is not an image falls back to inferred type from key or octet-stream.
    const storedType = response.ContentType || "";
    const effectiveType = IMAGE_CONTENT_TYPES.has(storedType)
      ? storedType
      : inferMimeFromKey(avatarKey);

    if (effectiveType && IMAGE_CONTENT_TYPES.has(effectiveType)) {
      headers.set("Content-Type", effectiveType);
      headers.set("Content-Disposition", "inline");
    } else {
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", "attachment");
    }
    // Belt-and-braces against MIME sniffing for any stored content.
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "public, max-age=31536000");
    headers.set("Accept-Ranges", "bytes");
    if (response.ContentLength) {
      headers.set("Content-Length", response.ContentLength.toString());
    }

    return new NextResponse(response.Body.transformToWebStream(), { headers });
  } catch (error) {
    // Ordinary missing objects use the default avatar. Bucket failures stay
    // visible in logs and fallback redirects must be safe to retry.
    const maybeS3 = error as {
      Code?: string;
      message?: string;
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const code = maybeS3?.Code ?? maybeS3?.name ?? "";
    const status = maybeS3?.$metadata?.httpStatusCode;
    const message = String(maybeS3?.message ?? "");
    const bucketUnavailable = isStorageBucketMissing(error);
    const isMissing =
      !bucketUnavailable && (code === "NoSuchKey" || status === 404);
    const isDiskExhausted =
      message.includes("Storage resources are insufficient") &&
      (code === "InternalError" || status === 500);
    if (bucketUnavailable) {
      console.error("Avatar storage bucket unavailable after retry");
    } else if (!isMissing && !isDiskExhausted && !request.signal.aborted) {
      console.error("Avatar proxy error:", error);
    }
    const fallbackPath = getDefaultAvatar(userId);
    return NextResponse.redirect(new URL(fallbackPath, request.url), {
      headers: { "Cache-Control": "no-store" },
      status: 307,
    });
  }
}

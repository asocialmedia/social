import { avatarCache, prisma } from "@asm/db";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient } from "@/lib/object-storage";
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
  const cached = await avatarCache.get(userId);
  if (cached?.key) {
    avatarKey = cached.key;
  }
  if (!avatarKey) {
    const user = await prisma.user.findUnique({
      select: { avatarKey: true },
      where: { id: userId },
    });
    avatarKey = user?.avatarKey ?? null;
  }

  if (!avatarKey) {
    const fallbackPath = getDefaultAvatar(userId);
    return NextResponse.redirect(new URL(fallbackPath, request.url), 307);
  }

  try {
    const response = await asmobClient.send(
      new GetObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: avatarKey,
      })
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
    console.error("Avatar proxy error:", error);
    const fallbackPath = getDefaultAvatar(userId);
    return NextResponse.redirect(new URL(fallbackPath, request.url), 307);
  }
}

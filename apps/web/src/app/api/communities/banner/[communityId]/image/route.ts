import { prisma } from "@asm/db";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

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

// Community banners live in the private ASMOB bucket and are streamed through
// this app route. Mirrors the user banner proxy.
export async function GET(
  _request: Request,
  context: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await context.params;

  const community = await prisma.community.findUnique({
    select: { bannerKey: true },
    where: { id: communityId },
  });
  const bannerKey = community?.bannerKey ?? null;
  if (!bannerKey) {
    return new NextResponse("Banner not found", { status: 404 });
  }

  try {
    const response = await asmobClient.send(
      new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: bannerKey })
    );
    if (!response.Body || response.ContentLength === 0) {
      return new NextResponse("Banner not found", { status: 404 });
    }

    const headers = new Headers();
    const storedType = response.ContentType || "";
    const effectiveType = IMAGE_CONTENT_TYPES.has(storedType)
      ? storedType
      : inferMimeFromKey(bannerKey);
    if (effectiveType && IMAGE_CONTENT_TYPES.has(effectiveType)) {
      headers.set("Content-Type", effectiveType);
      headers.set("Content-Disposition", "inline");
    } else {
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", "attachment");
    }
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "public, max-age=31536000");
    headers.set("Accept-Ranges", "bytes");
    if (response.ContentLength) {
      headers.set("Content-Length", response.ContentLength.toString());
    }

    return new NextResponse(response.Body.transformToWebStream(), { headers });
  } catch {
    return new NextResponse("Banner not found", { status: 404 });
  }
}

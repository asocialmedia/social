import { prisma } from "@asm/db";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient } from "@/lib/object-storage";

// Banners live in the private ASMOB bucket (key prefix `banners/{userId}/...`)
// and are streamed through this app route so content is only reachable via the
// app, never directly from object storage.
export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const { userId } = await context.params;

  const user = await prisma.user.findUnique({
    select: { bannerKey: true },
    where: { id: userId },
  });

  if (!user?.bannerKey) {
    return new NextResponse("Banner not found", { status: 404 });
  }

  try {
    const response = await asmobClient.send(
      new GetObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: user.bannerKey,
      })
    );

    if (!response.Body) {
      return new NextResponse("Banner not found", { status: 404 });
    }

    const headers = new Headers();
    // Serve only a fixed image allowlist. A legacy or crafted object whose
    // stored type is not an image falls back to octet-stream with an
    // attachment disposition so the browser can never sniff it into HTML.
    const IMAGE_CONTENT_TYPES = new Set([
      "image/gif",
      "image/heic",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    const storedType = response.ContentType || "";
    if (IMAGE_CONTENT_TYPES.has(storedType)) {
      headers.set("Content-Type", storedType);
      headers.set("Content-Disposition", "inline");
    } else {
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", "attachment");
    }
    // Belt-and-braces against MIME sniffing for any stored content.
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "public, max-age=31536000");
    if (response.ContentLength) {
      headers.set("Content-Length", response.ContentLength.toString());
    }

    return new NextResponse(response.Body.transformToWebStream(), { headers });
  } catch (error) {
    console.error("Banner proxy error:", error);
    return new NextResponse("Banner not found", { status: 404 });
  }
}

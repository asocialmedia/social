import { prisma } from "@asm/db";
import { isStorageBucketMissing } from "@asm/media";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";
import { retryProfileObjectRead } from "@/lib/media/profile-object-read";

// Banners live in the private ASMOB bucket (key prefix `banners/{userId}/...`)
// and are streamed through this app route so content is only reachable via the
// app, never directly from object storage.
export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const { userId } = await context.params;

  const user = await prisma.orm.public.Users.select("bannerKey")
    .where({ id: userId })
    .first();

  if (!user?.bannerKey) {
    return new NextResponse("Banner not found", { status: 404 });
  }

  try {
    const command = new GetObjectCommand({
      Bucket: ASMOB_BUCKET,
      Key: user.bannerKey,
    });
    const response = await retryProfileObjectRead(
      () => asmobClient.send(command, { abortSignal: request.signal }),
      request.signal
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
    if (isStorageBucketMissing(error)) {
      console.error("Banner storage bucket unavailable after retry");
      return new NextResponse("Banner temporarily unavailable", {
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
        status: 503,
      });
    }
    console.error("Banner proxy error:", error);
    return new NextResponse("Banner not found", { status: 404 });
  }
}

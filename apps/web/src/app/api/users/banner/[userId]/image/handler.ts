import { isStorageBucketMissing } from "@asm/media";
import { NextResponse } from "next/server";

import type { ReadProfileObject } from "@/lib/media/profile-object-read";
import { retryProfileObjectRead } from "@/lib/media/profile-object-read";

// Banners live in the private ASMOB bucket (key prefix `banners/{userId}/...`)
// and are streamed through this app route so content is only reachable via the
// app, never directly from object storage.
export async function serveBannerImage(
  request: Request,
  userId: string,
  lookupKey: (userId: string) => Promise<string | null>,
  readObject: ReadProfileObject
) {
  const bannerKey = await lookupKey(userId);
  if (!bannerKey) {
    return new NextResponse("Banner not found", { status: 404 });
  }

  try {
    const response = await retryProfileObjectRead(
      () => readObject(bannerKey, request.signal),
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
    if (error instanceof Error && error.name === "NoSuchKey") {
      return new NextResponse("Banner not found", { status: 404 });
    }
    console.error("Banner object read failed", {
      bucketUnavailable: isStorageBucketMissing(error),
    });
    return new NextResponse("Banner temporarily unavailable", {
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      status: 503,
    });
  }
}

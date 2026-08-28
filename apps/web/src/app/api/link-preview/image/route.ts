import { consumeRateLimit, getClientIpFromHeaders } from "@asm/db";
import { NextResponse } from "next/server";

import { fetchEmbedImage } from "@/lib/link-embeds/server";

// Proxies remote embed thumbnail images. Every embed imageUrl is a raw
// third-party URL that must never be handed to the browser directly: the
// fetch happens server-side behind the SSRF guard, only image/* payloads
// under the size cap pass through, and viewers never expose their IP (or
// cookies) to the origin site.

export async function GET(request: Request) {
  const ip = getClientIpFromHeaders(request.headers);
  const rate = await consumeRateLimit({
    bucket: "link-preview-image-ip",
    identifier: ip,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return new NextResponse("Too many requests", { status: 429 });
  }

  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return new NextResponse("url is required", { status: 400 });
  }

  const image = await fetchEmbedImage(url);
  if (!image) {
    // Deliberately opaque: rejected SSRF targets and dead images both 404.
    return new NextResponse("Image not found", { status: 404 });
  }

  return new NextResponse(image.body, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": image.contentType ?? "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

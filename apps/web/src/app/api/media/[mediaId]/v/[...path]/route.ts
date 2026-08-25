import { prisma } from "@asm/db";
import { hlsBaseFromMasterKey } from "@asm/media";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { decideMediaAccess } from "@/lib/media-access";
import {
  DERIVATIVE_MIME_BY_EXT,
  parseVariantRequest,
} from "@/lib/media-variants";
import {
  ASMOB_BUCKET,
  asmobClient,
  generatePresignedUrl,
} from "@/lib/object-storage";
import { getWebLogger } from "@/lib/otel";
import { getSessionFromApi } from "@/lib/session";

// Serves pipeline-generated derivatives: /api/media/{id}/v/{name}
//   images    thumb-webp, thumb-jpg, sm-webp, md-webp, lg-webp, orig-img-webp
//   video     poster, mp4-h264, hls/master.m3u8, hls/<segments>
//   audio     audio-opus (webm), audio-aac (m4a), wave-peaks.json
// Derivatives exist only for READY media; the lookup doubles as the lifecycle
// gate. Object keys never reach the client. Byte ranges are honored so
// <video> playback through a variant URL can seek without downloading the
// whole derivative.

// rustfs rejects SigV4 requests that sign a Range header, so ranged reads go
// through a presigned URL with Range applied at fetch time instead of through
// the SDK client. Same workaround as the main serving route.
async function fetchRange(
  objectKey: string,
  range: string,
  signal: AbortSignal
): Promise<Response> {
  const presignedUrl = await generatePresignedUrl(objectKey);
  return await fetch(presignedUrl, { headers: { Range: range }, signal });
}

function buildRangeNotSatisfiable(
  contentRangeHeader?: string | null
): NextResponse {
  const headers = new Headers();
  headers.set("Accept-Ranges", "bytes");
  if (contentRangeHeader) {
    headers.set("Content-Range", contentRangeHeader);
  }
  return new NextResponse("Range Not Satisfiable", { headers, status: 416 });
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ mediaId: string; path: string[] }>;
  }
): Promise<Response> {
  const { mediaId, path: rawPath } = await context.params;
  if (!mediaId || !Array.isArray(rawPath)) {
    return new NextResponse("Not found", { status: 400 });
  }

  // Ownership/visibility is read fresh (never cached), mirroring the main
  // serving route.
  const ownership = await prisma.media.findUnique({
    select: {
      commentId: true,
      detectedMime: true,
      key: true,
      mimeType: true,
      postId: true,
      publishedKey: true,
      status: true,
      userId: true,
    },
    where: { id: mediaId },
  });
  if (!ownership || ownership.status !== "READY") {
    return new NextResponse("Media not found", { status: 404 });
  }
  const session = await getSessionFromApi();
  const decision = decideMediaAccess(ownership, session?.user ?? null);
  if (!decision.allowed) {
    return new NextResponse("Media not found", { status: decision.status });
  }

  const parsed = parseVariantRequest(rawPath);
  if (!parsed) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    let objectKey: string | null = null;

    if ("hlsFile" in parsed) {
      const master = await prisma.mediaDerivative.findFirst({
        select: { key: true },
        where: { kind: "hls", mediaId, variant: "master" },
      });
      if (!master) {
        return new NextResponse("Not found", { status: 404 });
      }
      objectKey = `${hlsBaseFromMasterKey(master.key)}/${parsed.hlsFile}`;
    } else {
      const derivative = await prisma.mediaDerivative.findUnique({
        select: { key: true },
        where: {
          mediaId_kind_variant: {
            kind: parsed.kind,
            mediaId,
            variant: parsed.variant,
          },
        },
      });
      objectKey = derivative?.key ?? null;
    }

    let mimeType: string;
    if (objectKey) {
      const extension = objectKey.split(".").pop()?.toLowerCase() ?? "";
      mimeType =
        DERIVATIVE_MIME_BY_EXT[extension] ?? "application/octet-stream";
    } else {
      // Graceful fallback: READY media without the requested derivative
      // (legacy rows, GIFs, exotic formats) serves its published original
      // instead of 404ing, so callers can always point at a variant URL.
      if (ownership.status !== "READY") {
        return new NextResponse("Not found", { status: 404 });
      }
      objectKey = ownership.publishedKey ?? (ownership.key || null);
      if (!objectKey) {
        return new NextResponse("Not found", { status: 404 });
      }
      mimeType =
        ownership.detectedMime ??
        ownership.mimeType ??
        "application/octet-stream";
    }

    const range = request.headers.get("range") || undefined;

    let body: ReadableStream<Uint8Array>;
    let status = 200;
    const headers = new Headers();
    headers.set("Content-Type", mimeType);
    headers.set(
      "Cache-Control",
      ownership.postId
        ? "public, max-age=31536000, immutable"
        : "private, max-age=86400"
    );
    // HLS playlists must not be cached aggressively by shared caches so
    // takedowns propagate quickly; segments are content-addressed anyway.
    if (objectKey.endsWith(".m3u8")) {
      headers.set("Cache-Control", "public, max-age=60");
    }
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");

    if (range) {
      const upstream = await fetchRange(objectKey, range, request.signal);
      if (upstream.status === 416) {
        return buildRangeNotSatisfiable(upstream.headers.get("content-range"));
      }
      const contentRange = upstream.headers.get("content-range");
      if (!upstream.ok || upstream.status !== 206 || !contentRange) {
        throw new Error(
          `Storage range request failed: status=${upstream.status}`
        );
      }
      headers.set("Content-Range", contentRange);
      const contentLength = Number(upstream.headers.get("content-length") || 0);
      if (contentLength > 0) {
        headers.set("Content-Length", String(contentLength));
      }
      body = upstream.body as ReadableStream<Uint8Array>;
      status = 206;
    } else {
      const response = await asmobClient.send(
        new GetObjectCommand({
          Bucket: ASMOB_BUCKET,
          Key: objectKey,
        })
      );
      if (!response.Body) {
        return new NextResponse("Not found", { status: 404 });
      }
      if (response.ContentLength) {
        headers.set("Content-Length", String(response.ContentLength));
      }
      body =
        "transformToWebStream" in (response.Body as object)
          ? (
              response.Body as unknown as {
                transformToWebStream: () => ReadableStream<Uint8Array>;
              }
            ).transformToWebStream()
          : (response.Body as ReadableStream<Uint8Array>);
    }

    return new NextResponse(body, { headers, status });
  } catch (error) {
    // Client disconnected mid-stream (seek, scroll away, close): the request
    // is already gone, so answer with a bare 499 instead of a scary 500.
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    const logger = getWebLogger();
    if (logger) {
      logger.error({ error, mediaId }, "variant proxy error");
    } else {
      console.error("Variant proxy error:", error);
    }
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

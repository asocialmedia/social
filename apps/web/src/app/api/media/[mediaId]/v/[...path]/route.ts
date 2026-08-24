import { prisma } from "@asm/db";
import { hlsBaseFromMasterKey } from "@asm/media";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { decideMediaAccess } from "@/lib/media-access";
import {
  DERIVATIVE_MIME_BY_EXT,
  parseVariantRequest,
} from "@/lib/media-variants";
import { ASMOB_BUCKET, asmobClient } from "@/lib/object-storage";
import { getWebLogger } from "@/lib/otel";
import { getSessionFromApi } from "@/lib/session";

// Serves pipeline-generated derivatives: /api/media/{id}/v/{name}
//   images    thumb-webp, thumb-jpg, sm-webp, md-webp, lg-webp, orig-img-webp
//   video     poster, mp4-h264, hls/master.m3u8, hls/<segments>
//   audio     audio-opus (webm), audio-aac (m4a), wave-peaks.json
// Derivatives exist only for READY media; the lookup doubles as the lifecycle
// gate. Object keys never reach the client.

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
    select: { commentId: true, postId: true, status: true, userId: true },
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

    if (!objectKey) {
      return new NextResponse("Not found", { status: 404 });
    }

    const extension = objectKey.split(".").pop()?.toLowerCase() ?? "";
    const mimeType =
      DERIVATIVE_MIME_BY_EXT[extension] ?? "application/octet-stream";

    const response = await asmobClient.send(
      new GetObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: objectKey,
      })
    );
    if (!response.Body) {
      return new NextResponse("Not found", { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", response.ContentType ?? mimeType);
    headers.set(
      "Cache-Control",
      ownership.postId
        ? "public, max-age=31536000, immutable"
        : "private, max-age=86400"
    );
    headers.set("X-Content-Type-Options", "nosniff");
    if (response.ContentLength) {
      headers.set("Content-Length", String(response.ContentLength));
    }
    // HLS playlists must not be cached aggressively by shared caches so
    // takedowns propagate quickly; segments are content-addressed anyway.
    if (objectKey.endsWith(".m3u8")) {
      headers.set("Cache-Control", "public, max-age=60");
    }

    const body =
      "transformToWebStream" in (response.Body as object)
        ? (
            response.Body as unknown as {
              transformToWebStream: () => ReadableStream;
            }
          ).transformToWebStream()
        : (response.Body as ReadableStream);

    return new NextResponse(body, { headers });
  } catch (error) {
    const logger = getWebLogger();
    if (logger) {
      logger.error({ error, mediaId }, "variant proxy error");
    } else {
      console.error("Variant proxy error:", error);
    }
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

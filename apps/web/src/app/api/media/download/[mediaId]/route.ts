import { prisma } from "@asm/db";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { decideMediaAccess } from "@/lib/media-access";
import { ASMOB_BUCKET, asmobClient } from "@/lib/object-storage";
import { getWebLogger } from "@/lib/otel";
import { getSessionFromApi } from "@/lib/session";
import {
  getContentDisposition,
  isBlockedMediaMime,
  shouldForceAttachment,
} from "@/lib/utils/mime-utils";

// Streams the stored object back as a forced download. The database row is
// never serialized to the client: only the bytes and a filename leave the
// server, so storage keys and ownership metadata stay private.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ mediaId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mediaId } = await ctx.params;
  const media = await prisma.media.findUnique({
    select: {
      commentId: true,
      key: true,
      mimeType: true,
      postId: true,
      publishedKey: true,
      size: true,
      status: true,
      userId: true,
    },
    where: { id: mediaId },
  });
  if (!media) {
    return new NextResponse("Media not found", { status: 404 });
  }

  // Lifecycle gate — mirrors the main serving route's isServableMedia.
  // REJECTED/DELETED rows are never downloadable, and pre-READY pipeline
  // rows that have not yet published are not servable either. Legacy rows
  // (UPLOADING with a real key) remain downloadable until backfill converts
  // them; once converted to REJECTED the gate blocks them too.
  if (
    media.status === "REJECTED" ||
    media.status === "DELETED" ||
    media.status === "FAILED"
  ) {
    return new NextResponse("Media not found", { status: 404 });
  }
  if (
    media.status !== "READY" &&
    !media.publishedKey &&
    media.key.length === 0
  ) {
    return new NextResponse("Media not found", { status: 404 });
  }

  const decision = decideMediaAccess(media, user);
  if (!decision.allowed) {
    return new NextResponse(
      decision.status === 401 ? "Unauthorized" : "Media not found",
      { status: decision.status }
    );
  }

  // SVG / PDF / code payloads have no support at any level - downloads are
  // rejected too, not just inline rendering.
  if (isBlockedMediaMime(media.mimeType)) {
    return new NextResponse("Unsupported media type", { status: 415 });
  }

  const objectKey = media.publishedKey || media.key;
  if (!objectKey) {
    return new NextResponse("Media not found", { status: 404 });
  }

  try {
    const response = await asmobClient.send(
      new GetObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: objectKey,
      })
    );
    if (!response.Body) {
      return new NextResponse("Media content not found", { status: 404 });
    }

    const body =
      "transformToWebStream" in (response.Body as object)
        ? (
            response.Body as unknown as {
              transformToWebStream: () => ReadableStream;
            }
          ).transformToWebStream()
        : (response.Body as ReadableStream);

    const filename = objectKey.split("/").pop() || "file";
    const headers = new Headers();
    headers.set(
      "Content-Type",
      response.ContentType || media.mimeType || "application/octet-stream"
    );
    // Downloads are always attachments; SVG/text payloads can never opt out.
    headers.set("Content-Disposition", getContentDisposition(filename, false));
    if (shouldForceAttachment(media.mimeType)) {
      headers.set("X-Content-Type-Options", "nosniff");
    }
    if (response.ContentLength) {
      headers.set("Content-Length", response.ContentLength.toString());
    }

    return new NextResponse(body, { headers });
  } catch (error) {
    // A row whose stored object vanished from storage is a missing asset,
    // not a server fault - respond like an unknown media id.
    if (
      error instanceof S3ServiceException &&
      (error.name === "NoSuchKey" || error.$metadata.httpStatusCode === 404)
    ) {
      return new NextResponse("Media not found", { status: 404 });
    }
    const logger = getWebLogger();
    if (logger) {
      logger.error({ error, mediaId }, "Media download failed");
    } else {
      console.error("Media download failed:", error);
    }
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

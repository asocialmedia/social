import { prisma } from "@asm/db";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import { decideMediaAccess } from "@/lib/media/media-access";
import { mediaError, mediaJsonError } from "@/lib/media/media-responses";
import { resolveMessageMediaMembership } from "@/lib/media/message-media-access";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";
import { getWebLogger } from "@/lib/otel";
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
    return mediaJsonError("Unauthorized", 401);
  }

  const { mediaId } = await ctx.params;
  const media = await prisma.orm.public.PostMedia.select(
    "commentId",
    "key",
    "messageConversationId",
    "mimeType",
    "postId",
    "publishedKey",
    "size",
    "status",
    "userId"
  )
    .where({ id: mediaId })
    .first();
  if (!media) {
    return mediaError("Media not found", 404);
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
    return mediaError("Media not found", 404);
  }
  if (
    media.status !== "READY" &&
    !media.publishedKey &&
    media.key.length === 0
  ) {
    return mediaError("Media not found", 404);
  }

  const decision = decideMediaAccess(media, user, {
    isConversationMember: await resolveMessageMediaMembership(
      media.messageConversationId,
      user.id
    ),
  });
  if (!decision.allowed) {
    return mediaError(
      decision.status === 401 ? "Unauthorized" : "Media not found",
      decision.status
    );
  }

  // SVG / PDF / code payloads have no support at any level - downloads are
  // rejected too, not just inline rendering.
  if (isBlockedMediaMime(media.mimeType)) {
    return mediaError("Unsupported media type", 415);
  }

  const objectKey = media.publishedKey || media.key;
  if (!objectKey) {
    return mediaError("Media not found", 404);
  }

  try {
    const response = await asmobClient.send(
      new GetObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: objectKey,
      })
    );
    if (!response.Body) {
      return mediaError("Media content not found", 404);
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
      return mediaError("Media not found", 404);
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

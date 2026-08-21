import { prisma } from "@asm/db";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { decideMediaAccess } from "@/lib/media-access";
import { ASMOB_BUCKET, asmobClient } from "@/lib/object-storage";
import { getWebLogger } from "@/lib/otel";
import { getSessionFromApi } from "@/lib/session";
import {
  getContentDisposition,
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
      size: true,
      userId: true,
    },
    where: { id: mediaId },
  });
  if (!media) {
    return new NextResponse("Media not found", { status: 404 });
  }

  const decision = decideMediaAccess(media, user);
  if (!decision.allowed) {
    return new NextResponse(
      decision.status === 401 ? "Unauthorized" : "Media not found",
      { status: decision.status }
    );
  }

  try {
    const response = await asmobClient.send(
      new GetObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: media.key,
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

    const filename = media.key.split("/").pop() || "file";
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
    const logger = getWebLogger();
    if (logger) {
      logger.error({ error, mediaId }, "Media download failed");
    } else {
      console.error("Media download failed:", error);
    }
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

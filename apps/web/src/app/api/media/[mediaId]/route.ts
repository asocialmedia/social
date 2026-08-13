import { prisma } from "@asm/db";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { ASMOB_BUCKET, asmobClient } from "@/lib/object-storage";
import {
  getContentDisposition,
  shouldDisplayInline,
} from "@/lib/utils/mime-utils";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> }
): Promise<NextResponse | Response> {
  const { mediaId } = await context.params;
  if (!mediaId) {
    return new NextResponse("Media ID is required", { status: 400 });
  }

  const media = await prisma.media.findUnique({
    select: {
      id: true,
      key: true,
      mimeType: true,
      size: true,
      type: true,
    },
    where: { id: mediaId },
  });

  if (!media) {
    return new NextResponse("Media not found", { status: 404 });
  }

  try {
    const url = new URL(request.url);
    const download = url.searchParams.get("download") === "true";
    // Browsers ask for a byte range when loading <video>/<audio> and when
    // seeking. Forward the request to storage so only the requested chunk is
    // transferred instead of the whole file on every interaction.
    const range = request.headers.get("range") || undefined;

    const command = new GetObjectCommand({
      Bucket: ASMOB_BUCKET,
      Key: media.key,
      ...(range ? { Range: range } : {}),
    });

    const response = await asmobClient.send(command);

    if (!response.Body) {
      return new NextResponse("Media content not found", { status: 404 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      media.mimeType || response.ContentType || "application/octet-stream"
    );

    const filename = media.key.split("/").pop() || "file";
    const inline = !download && shouldDisplayInline(media.mimeType);
    headers.set("Content-Disposition", getContentDisposition(filename, inline));
    headers.set("Cache-Control", "public, max-age=31536000");
    headers.set("Accept-Ranges", "bytes");

    // If storage honored the Range, respond 206 with the partial content and
    // the Content-Range header so the browser can resume/seek correctly.
    const isPartial = range !== undefined && response.ContentRange;
    if (isPartial) {
      headers.set("Content-Range", response.ContentRange as string);
      if (response.ContentLength) {
        headers.set("Content-Length", response.ContentLength.toString());
      }
      return new NextResponse(response.Body.transformToWebStream(), {
        status: 206,
        headers,
      });
    }

    if (response.ContentLength) {
      headers.set("Content-Length", response.ContentLength.toString());
    }

    return new NextResponse(response.Body.transformToWebStream(), { headers });
  } catch (error) {
    // Object storage rejects invalid or unsatisfiable byte ranges with 416;
    // forward that as a proper Range Not Satisfiable so clients can retry or
    // resume instead of surfacing a server error.
    const httpStatus =
      error instanceof S3ServiceException
        ? error.$metadata.httpStatusCode
        : undefined;
    if (httpStatus === 416) {
      const headers = new Headers();
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Range", `bytes */${media.size}`);
      return new NextResponse("Range Not Satisfiable", {
        status: 416,
        headers,
      });
    }
    console.error("Media proxy error:", error);
    return new NextResponse(
      `Internal Server Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      { status: 500 }
    );
  }
}

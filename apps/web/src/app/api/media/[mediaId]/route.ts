import { prisma } from "@asm/db";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { cacheLife, cacheTag } from "next/cache";
import { NextResponse } from "next/server";

import { decideMediaAccess } from "@/lib/media-access";
import {
  ASMOB_BUCKET,
  asmobClient,
  generatePresignedUrl,
} from "@/lib/object-storage";
import { getWebLogger } from "@/lib/otel";
import { getSessionFromApi } from "@/lib/session";
import {
  getContentDisposition,
  isBlockedMediaMime,
  shouldDisplayInline,
  shouldForceAttachment,
} from "@/lib/utils/mime-utils";

// Object-serving fields are immutable for a given media id (the stored key,
// mime and size never change), so they are safe to cache for a long window.
// This keeps feed scrolls that render many posters/images from hammering the
// database on every request; the object itself is still streamed fresh from
// storage each time.
async function getMediaObject(mediaId: string) {
  "use cache";
  cacheLife("hours");
  cacheTag("media-object");

  return await prisma.media.findUnique({
    select: {
      id: true,
      key: true,
      mimeType: true,
      publishedKey: true,
      size: true,
      status: true,
      thumbnailKey: true,
      type: true,
    },
    where: { id: mediaId },
  });
}

// Lifecycle gate. New-pipeline rows become publicly servable only once the
// controlled pipeline reaches READY; quarantine/scan/processing states never
// expose bytes. Legacy rows (created before the pipeline) carry their object
// key in the old column and keep serving exactly as before so existing posts
// are untouched; REJECTED/DELETED rows are dead in every generation.
function isServableMedia(
  media: Awaited<ReturnType<typeof getMediaObject>>
): boolean {
  if (!media) {
    return false;
  }
  if (media.status === "REJECTED" || media.status === "DELETED") {
    return false;
  }
  if (media.status === "READY") {
    return true;
  }
  // Pipeline rows published before derivatives existed serve their
  // published original; pre-pipeline rows fall back to the legacy key.
  return Boolean(media.publishedKey) || media.key.length > 0;
}

// Resolution order matters after legacy GC retires the old object: prefer
// the pipeline's content-hashed original, then fall back to the legacy key.
function resolveObjectKey(
  media: NonNullable<Awaited<ReturnType<typeof getMediaObject>>>
): string {
  return media.publishedKey || media.key;
}

// Ownership columns are NOT immutable: a draft upload starts unlinked
// (postId null) and becomes public when the post is created. Caching them
// would leave a stale "protected" row that 401s real images for hours, so
// the access decision always reads fresh ownership data on a single indexed
// PK lookup.
async function getMediaOwnership(mediaId: string) {
  return await prisma.media.findUnique({
    select: {
      commentId: true,
      mimeType: true,
      postId: true,
      userId: true,
    },
    where: { id: mediaId },
  });
}

// Object storage rejects invalid or unsatisfiable byte ranges with the
// InvalidRange error (HTTP 416); respond Range Not Satisfiable so clients can
// retry or resume instead of surfacing a server error. Preserve the
// storage-reported Content-Range when it is available.
function buildRangeNotSatisfiableResponse(
  totalSize: number | null,
  contentRangeHeader?: string | null
): NextResponse {
  const headers = new Headers();
  headers.set("Accept-Ranges", "bytes");
  // Only emit a Content-Range when we actually know the total size; a
  // `bytes */null` header is invalid and worse than omitting it.
  const contentRange =
    contentRangeHeader || (totalSize ? `bytes */${totalSize}` : "");
  if (contentRange) {
    headers.set("Content-Range", contentRange);
  }
  return new NextResponse("Range Not Satisfiable", { headers, status: 416 });
}

function rangeNotSatisfiable(
  error: unknown,
  totalSize: number | null
): NextResponse | null {
  if (!(error instanceof S3ServiceException)) {
    return null;
  }
  const invalidRange =
    error.name === "InvalidRange" || error.$metadata.httpStatusCode === 416;
  if (!invalidRange) {
    return null;
  }
  const storageContentRange = (
    error as S3ServiceException & { ContentRange?: string }
  ).ContentRange;
  return buildRangeNotSatisfiableResponse(totalSize, storageContentRange);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> }
): Promise<NextResponse | Response> {
  const { mediaId } = await context.params;
  if (!mediaId) {
    return new NextResponse("Media ID is required", { status: 400 });
  }

  const media = await getMediaObject(mediaId);

  if (!media) {
    return new NextResponse("Media not found", { status: 404 });
  }

  // Lifecycle: bytes exist publicly only after the pipeline says so (or for
  // legacy rows). Quarantined/scanning/processing content is never served.
  if (!isServableMedia(media)) {
    return new NextResponse("Media not found", { status: 404 });
  }

  // Authorization: post attachments are public, comment media needs a
  // session, message/draft uploads are owner-only (see media-access.ts).
  // Ownership is read fresh (never cached) so a just-published post's
  // attachments become public immediately instead of serving a stale
  // "protected" row.
  const ownership = await getMediaOwnership(mediaId);
  if (!ownership) {
    return new NextResponse("Media not found", { status: 404 });
  }
  const session = await getSessionFromApi();
  const decision = decideMediaAccess(ownership, session?.user ?? null);
  if (!decision.allowed) {
    return new NextResponse(
      decision.status === 401 ? "Unauthorized" : "Media not found",
      { status: decision.status }
    );
  }

  // SVG / PDF / code payloads have no support at any level - not inline, not
  // download. Reject before touching storage.
  if (isBlockedMediaMime(ownership.mimeType)) {
    return new NextResponse("Unsupported media type", { status: 415 });
  }

  try {
    const url = new URL(request.url);
    const download = url.searchParams.get("download") === "true";
    const isThumbnail = url.searchParams.get("thumb") === "1";
    if (isThumbnail && media.type === "VIDEO") {
      // thumbnailKey is written AFTER publish by the process job, so reading
      // it from the hours-cached object would pin "no thumbnail" until cache
      // expiry - freshly posted videos would show no frame without a manual
      // refresh. Pull it fresh (single indexed PK lookup), same reason
      // ownership is read fresh below.
      const freshThumb = await prisma.media.findUnique({
        select: { status: true, thumbnailKey: true },
        where: { id: mediaId },
      });
      // Pipeline videos keep their scene-aware poster as a derivative;
      // legacy videos keep the old thumbnailKey column. Serve whichever
      // exists so feed cards get a real frame, and only fall back to the
      // lightweight placeholder SVG when neither does (image renderers must
      // never download multi-megabyte video streams pretending to be images).
      let posterKey: string | null = freshThumb?.thumbnailKey ?? null;
      if (!posterKey && freshThumb?.status === "READY") {
        const poster = await prisma.mediaDerivative.findFirst({
          select: { key: true },
          where: { kind: "poster", mediaId },
        });
        posterKey = poster?.key ?? null;
      }
      if (!posterKey) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" fill="#18181b"><rect width="640" height="360" fill="#18181b"/></svg>`;
        return new NextResponse(svg, {
          headers: {
            "Cache-Control": "public, max-age=60",
            "Content-Type": "image/svg+xml",
            "X-Content-Type-Options": "nosniff",
          },
          status: 200,
        });
      }
      const posterObject = await asmobClient.send(
        new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: posterKey })
      );
      return new NextResponse(posterObject.Body as ReadableStream, {
        headers: {
          "Cache-Control": ownership.postId
            ? "public, max-age=31536000, immutable"
            : "private, max-age=86400",
          "Content-Type": "image/jpeg",
          "X-Content-Type-Options": "nosniff",
        },
        status: 200,
      });
    }

    // Video thumbnails live under their own key; serving them through this
    // route keeps the bucket private while giving every consumer one URL.
    const objectKey =
      isThumbnail && media.thumbnailKey
        ? media.thumbnailKey
        : resolveObjectKey(media);
    // Browsers ask for a byte range when loading <video>/<audio> and when
    // seeking. Forward the request to storage so only the requested chunk is
    // transferred instead of the whole file on every interaction. Thumbnails
    // are small JPEGs and never need ranges.
    const range = isThumbnail
      ? undefined
      : request.headers.get("range") || undefined;

    const command = new GetObjectCommand({
      Bucket: ASMOB_BUCKET,
      Key: objectKey,
      ...(range ? { Range: range } : {}),
    });

    // rustfs (the object-storage backend) rejects SigV4 requests that sign a
    // Range header with SignatureDoesNotMatch, breaking video streaming/seeking
    // (browsers always request ranges for <video>). Presigned URLs only sign
    // the query string, so Range reads through them work reliably.
    let response;
    if (range) {
      const presignedUrl = await generatePresignedUrl(objectKey);
      // Abort the upstream fetch when the client disconnects (seek, scroll
      // away, close). Otherwise the piped body keeps writing into a closed
      // destination and Next.js surfaces "The destination stream closed early".
      const upstream = await fetch(presignedUrl, {
        headers: { Range: range },
        signal: request.signal,
      });

      // Storage signals an unsatisfiable range with 416; surface that to the
      // client instead of treating it as a generic server error.
      if (upstream.status === 416) {
        return buildRangeNotSatisfiableResponse(
          media.size,
          upstream.headers.get("content-range")
        );
      }

      // A valid partial response must be 206 with a Content-Range. Reject a
      // 200 (storage ignored the range and returned the whole object) and any
      // 206 missing the Content-Range header, which would confuse the client.
      const contentRange = upstream.headers.get("content-range");
      if (!upstream.ok || upstream.status !== 206 || !contentRange) {
        throw new Error(
          `Storage range request failed: status=${upstream.status}`
        );
      }

      response = {
        Body: upstream.body as ReadableStream | null,
        ContentLength:
          Number(upstream.headers.get("content-length") || 0) || null,
        ContentRange: contentRange,
        ContentType: upstream.headers.get("content-type") || media.mimeType,
        statusCode: upstream.status,
      };
    } else {
      response = await asmobClient.send(command);
    }

    if (!response.Body) {
      return new NextResponse("Media content not found", { status: 404 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      isThumbnail
        ? "image/jpeg"
        : media.mimeType || response.ContentType || "application/octet-stream"
    );

    const filename = media.key.split("/").pop() || "file";
    // SVG and text-like payloads are always forced into a download so the
    // browser never renders/executes them from our origin (stored-XSS guard).
    const inline =
      !download &&
      shouldDisplayInline(media.mimeType) &&
      !shouldForceAttachment(media.mimeType);
    headers.set("Content-Disposition", getContentDisposition(filename, inline));
    // Post-linked media is immutable (a new upload creates a new row), so it
    // may be cached long-lived by browsers and shared caches. Comment/message
    // media is session-scoped and owner-only media must not leave a shared
    // cache without re-running decideMediaAccess, so those are private and
    // never stored.
    headers.set(
      "Cache-Control",
      ownership.postId
        ? "public, max-age=31536000, immutable"
        : "private, no-store"
    );
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");

    // Normalize the body to a Web ReadableStream: the SDK returns a WebStream
    // (has transformToWebStream), while the presigned-URL fetch returns a
    // WHATWG ReadableStream that can be piped directly.
    const body =
      "transformToWebStream" in (response.Body as object)
        ? (
            response.Body as unknown as {
              transformToWebStream: () => ReadableStream;
            }
          ).transformToWebStream()
        : (response.Body as ReadableStream);

    // If storage honored the Range, respond 206 with the partial content and
    // the Content-Range header so the browser can resume/seek correctly.
    const isPartial = range !== undefined && response.ContentRange;
    if (isPartial) {
      headers.set("Content-Range", response.ContentRange as string);
      if (response.ContentLength) {
        headers.set("Content-Length", response.ContentLength.toString());
      }
      return new NextResponse(body, {
        headers,
        status: 206,
      });
    }

    if (response.ContentLength) {
      headers.set("Content-Length", response.ContentLength.toString());
    }

    return new NextResponse(body, { headers });
  } catch (error) {
    const rangeResponse = rangeNotSatisfiable(error, media.size);
    if (rangeResponse) {
      return rangeResponse;
    }
    // The client disconnected (seek, scroll away, close tab) before the stream
    // finished; the request is already gone so there is nothing meaningful to
    // send back. Return a bare 499 (client closed request) instead of logging
    // a scary 500 or re-throwing into the framework.
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    // A row whose stored object vanished from storage (crash between publish
    // flip and upload, corrupted duplicate rows) is a missing asset, not a
    // server fault - respond like an unknown media id.
    if (
      error instanceof S3ServiceException &&
      (error.name === "NoSuchKey" || error.$metadata.httpStatusCode === 404)
    ) {
      return new NextResponse("Media not found", { status: 404 });
    }
    const logger = getWebLogger();
    const payload = { error, mediaId };
    if (logger) {
      logger.error(payload, "Media proxy error");
    } else {
      console.error("Media proxy error:", error);
    }
    // Deliberately opaque: internal error details (storage endpoints, keys)
    // must never reach the client.
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

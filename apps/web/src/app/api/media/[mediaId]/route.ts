import { and, canViewCommunity, prisma } from "@asm/db";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  decideMediaAccess,
  resolveOwningCommunity,
} from "@/lib/media/media-access";
import { mediaError } from "@/lib/media/media-responses";
import { resolveMessageMediaMembership } from "@/lib/media/message-media-access";
import {
  ASMOB_BUCKET,
  asmobClient,
  generatePresignedUrl,
} from "@/lib/media/object-storage";
import { getWebLogger } from "@/lib/otel";
import {
  getContentDisposition,
  isBlockedMediaMime,
  shouldDisplayInline,
  shouldForceAttachment,
} from "@/lib/utils/mime-utils";

function isValidWebVtt(vtt: string): boolean {
  return /(?:\d{2}:)?\d{2}:\d{2}\.\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}\.\d{3}/.test(
    vtt
  );
}

// Object-serving fields are queried fresh to ensure pipeline status transitions
// (UPLOADING -> SCANNING -> READY) and published keys are immediately visible
// without stale cache misses.
async function getMediaObject(mediaId: string) {
  return await prisma.orm.public.PostMedia.select(
    "id",
    "key",
    "mimeType",
    "publishedKey",
    "size",
    "status",
    "thumbnailKey",
    "_type"
  )
    .where({ id: mediaId })
    .first();
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
  const ownership = await prisma.orm.public.PostMedia.select(
    "commentId",
    "messageConversationId",
    "mimeType",
    "postId",
    "userId"
  )
    .include("comment", (comment) =>
      comment
        .select("postId")
        .include("post", (post) =>
          post
            .select("communityId")
            .include("community", (community) =>
              community.select("id", "_type")
            )
        )
    )
    .include("post", (post) =>
      post
        .select("communityId")
        .include("community", (community) => community.select("id", "_type"))
    )
    .include("postMediaDerivatives", (derivative) =>
      derivative.select("durationMs")
    )
    .where({ id: mediaId })
    .first();

  if (!ownership) {
    return null;
  }

  return {
    ...ownership,
    comment: ownership.comment
      ? {
          ...ownership.comment,
          post: ownership.comment.post
            ? {
                ...ownership.comment.post,
                community: ownership.comment.post.community
                  ? {
                      ...ownership.comment.post.community,
                      type: ownership.comment.post.community._type,
                    }
                  : null,
              }
            : null,
        }
      : null,
    derivatives: ownership.postMediaDerivatives,
    post: ownership.post
      ? {
          ...ownership.post,
          community: ownership.post.community
            ? {
                ...ownership.post.community,
                type: ownership.post.community._type,
              }
            : null,
        }
      : null,
  };
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
    return mediaError("Media ID is required", 400);
  }

  const media = await getMediaObject(mediaId);

  if (!media) {
    return mediaError("Media not found", 404);
  }

  // Lifecycle: bytes exist publicly only after the pipeline says so (or for
  // legacy rows). Quarantined/scanning/processing content is never served.
  if (!isServableMedia(media)) {
    return mediaError("Media not found", 404);
  }

  // Authorization: post attachments are public, comment media needs a
  // session, message attachments admit conversation members (see
  // media-access.ts), and drafts stay owner-only.
  // Ownership is read fresh (never cached) so a just-published post's
  // attachments become public immediately instead of serving a stale
  // "protected" row.
  const ownership = await getMediaOwnership(mediaId);
  if (!ownership) {
    return mediaError("Media not found", 404);
  }
  const session = await getSessionFromApi();
  const viewer = session?.user ?? null;
  const isConversationMember = await resolveMessageMediaMembership(
    ownership.messageConversationId,
    viewer?.id
  );
  const owningCommunity = resolveOwningCommunity(ownership);
  const isPrivateCommunityPost = owningCommunity?.type === "PRIVATE";
  const isCommunityMember =
    isPrivateCommunityPost && owningCommunity
      ? await canViewCommunity(owningCommunity, viewer?.id ?? "")
      : false;
  const decision = decideMediaAccess(
    {
      commentId: ownership.commentId,
      isPrivateCommunityPost,
      messageConversationId: ownership.messageConversationId,
      postId: ownership.postId,
      userId: ownership.userId,
    },
    viewer,
    {
      isCommunityMember,
      isConversationMember,
    }
  );
  if (!decision.allowed) {
    return mediaError(
      decision.status === 401 ? "Unauthorized" : "Media not found",
      decision.status
    );
  }

  // SVG / PDF / code payloads have no support at any level - not inline, not
  // download. Reject before touching storage.
  if (isBlockedMediaMime(ownership.mimeType)) {
    return mediaError("Unsupported media type", 415);
  }

  try {
    const url = new URL(request.url);
    const download = url.searchParams.get("download") === "true";
    const isThumbnail = url.searchParams.get("thumb") === "1";
    const isCaptions =
      url.searchParams.get("captions") === "1" ||
      url.searchParams.get("vtt") === "1";

    if (isCaptions) {
      const freshMedia = await prisma.orm.public.PostMedia.select(
        "captionsKey",
        "transcript"
      )
        .where({ id: mediaId })
        .first();
      if (freshMedia?.captionsKey) {
        try {
          const captionsObject = await asmobClient.send(
            new GetObjectCommand({
              Bucket: ASMOB_BUCKET,
              Key: freshMedia.captionsKey,
            })
          );
          const rawVtt = await captionsObject.Body?.transformToString();
          // If the S3 captions file actually contains valid WebVTT cue timestamps, serve it.
          // If it was stored as an empty header without cues, fall through to
          // generate clean line-by-line subtitle cues from the transcript.
          if (rawVtt && isValidWebVtt(rawVtt)) {
            return new NextResponse(rawVtt, {
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control":
                  ownership.postId && !isPrivateCommunityPost
                    ? "public, max-age=31536000, immutable"
                    : "private, no-store",
                "Content-Type": "text/vtt; charset=utf-8",
                "X-Content-Type-Options": "nosniff",
              },
              status: 200,
            });
          }
        } catch {
          // Fall through to transcript fallback
        }
      }
      if (freshMedia?.transcript) {
        let vttContent = freshMedia.transcript;
        if (!isValidWebVtt(vttContent)) {
          const rawChunks = freshMedia.transcript
            .split(/(?<=[.?!])\s+|\r?\n+/)
            .map((l) => l.trim())
            .filter(Boolean);

          const lines: string[] = [];
          for (const chunk of rawChunks) {
            const words = chunk.split(/\s+/).filter(Boolean);
            if (words.length <= 8) {
              lines.push(words.join(" "));
            } else {
              for (let i = 0; i < words.length; i += 7) {
                lines.push(words.slice(i, i + 7).join(" "));
              }
            }
          }
          if (lines.length === 0) {
            const words = freshMedia.transcript.split(/\s+/).filter(Boolean);
            for (let i = 0; i < words.length; i += 7) {
              lines.push(words.slice(i, i + 7).join(" "));
            }
          }

          const maxDurationMs = Math.max(
            0,
            ...ownership.derivatives.map(
              (derivative) => derivative.durationMs ?? 0
            )
          );
          const totalSeconds =
            maxDurationMs > 0
              ? Math.max(5, Math.ceil(maxDurationMs / 1000))
              : Math.max(10, lines.length * 3);

          const step = totalSeconds / Math.max(1, lines.length);
          let currentT = 0;
          const formattedCues = lines.map((line, idx) => {
            const isLast = idx === lines.length - 1;
            const startSec = currentT;
            const endSec = isLast
              ? totalSeconds
              : Math.min(totalSeconds, currentT + step);
            currentT = endSec;

            const sH = String(Math.floor(startSec / 3600)).padStart(2, "0");
            const sM = String(Math.floor((startSec % 3600) / 60)).padStart(
              2,
              "0"
            );
            const sS = String(Math.floor(startSec % 60)).padStart(2, "0");

            const eH = String(Math.floor(endSec / 3600)).padStart(2, "0");
            const eM = String(Math.floor((endSec % 3600) / 60)).padStart(
              2,
              "0"
            );
            const eS = String(Math.floor(endSec % 60)).padStart(2, "0");

            return `${idx + 1}\n${sH}:${sM}:${sS}.000 --> ${eH}:${eM}:${eS}.000\n${line}\n`;
          });
          vttContent = `WEBVTT - AsocialMedia Video Captions\n\n${formattedCues.join("\n")}`;
        }
        return new NextResponse(vttContent, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            // Transcript-derived cues can be re-generated by the pipeline
            // (re-analysis rewrites them), so this stays private and
            // uncacheable for drafts and short-lived for attached media.
            "Cache-Control":
              ownership.postId && !isPrivateCommunityPost
                ? "public, max-age=3600"
                : "private, no-store",
            "Content-Type": "text/vtt; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
          status: 200,
        });
      }
      return new NextResponse("WEBVTT\n\n", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          // Only public post-linked media may use a shared cache; this fallback
          // is still a viewer-gated response (comment/message/draft/private),
          // so it must not be stored.
          "Cache-Control":
            ownership.postId && !isPrivateCommunityPost
              ? "public, max-age=60"
              : "private, no-store",
          "Content-Type": "text/vtt; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
        status: 200,
      });
    }
    if (isThumbnail && media._type === "VIDEO") {
      // thumbnailKey is written AFTER publish by the process job, so reading
      // it from the hours-cached object would pin "no thumbnail" until cache
      // expiry - freshly posted videos would show no frame without a manual
      // refresh. Pull it fresh (single indexed PK lookup), same reason
      // ownership is read fresh below.
      const freshThumb = await prisma.orm.public.PostMedia.select(
        "customThumbnailKey",
        "status",
        "thumbnailKey"
      )
        .where({ id: mediaId })
        .first();
      // Priority: the author's custom cover (gust thumbnail) first, then the
      // pipeline's scene-aware poster derivative, then the legacy
      // thumbnailKey column. Serve whichever exists so feed cards get a real
      // frame, and only fall back to the lightweight placeholder SVG when
      // none does (image renderers must never download multi-megabyte video
      // streams pretending to be images).
      let posterKey: string | null = freshThumb?.customThumbnailKey ?? null;
      if (!posterKey && freshThumb?.status === "READY") {
        const poster = await prisma.orm.public.PostMediaDerivatives.select(
          "key"
        )
          .where((derivative) =>
            and(derivative.kind.eq("poster"), derivative.mediaId.eq(mediaId))
          )
          .first();
        if (poster?.key) {
          posterKey = poster.key;
        } else {
          const thumbPoster =
            await prisma.orm.public.PostMediaDerivatives.select("key")
              .where((derivative) =>
                and(
                  derivative.kind.eq("poster-thumb"),
                  derivative.mediaId.eq(mediaId)
                )
              )
              .first();
          posterKey = thumbPoster?.key ?? freshThumb?.thumbnailKey ?? null;
        }
      }
      if (!posterKey) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" fill="#18181b"><rect width="640" height="360" fill="#18181b"/></svg>`;
        return new NextResponse(svg, {
          headers: {
            // Short-lived for public post media: this placeholder only exists
            // while the pipeline's poster encode is in flight (row READY,
            // poster pending), and a long max-age pinned the gray box on feed
            // cards for a full minute after the real frame became servable.
            // Viewer-gated media (comment/message/draft/private community)
            // must not be stored at all.
            "Cache-Control":
              ownership.postId && !isPrivateCommunityPost
                ? "public, max-age=3"
                : "private, no-store",
            "Content-Type": "image/svg+xml",
            "X-Content-Type-Options": "nosniff",
          },
          status: 200,
        });
      }
      const posterObject = await asmobClient.send(
        new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: posterKey })
      );
      // A private community's poster must not be retained by the browser at
      // all: access can be revoked (the member leaves), and a 24h-cached frame
      // would keep rendering after that. Public post media stays immutable, and
      // other private media (comment/message drafts) keeps its short cache.
      let posterCacheControl = "private, max-age=86400";
      if (ownership.postId && !isPrivateCommunityPost) {
        posterCacheControl = "public, max-age=31536000, immutable";
      } else if (isPrivateCommunityPost) {
        posterCacheControl = "private, no-store";
      }
      return new NextResponse(posterObject.Body as ReadableStream, {
        headers: {
          "Cache-Control": posterCacheControl,
          // Custom thumbnails copy the source image's content type; pipeline
          // posters are always jpeg.
          "Content-Type": posterObject.ContentType ?? "image/jpeg",
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

      // Object or bucket missing: rustfs returns 404 for absent keys/buckets
      // (seen in prod as NoSuchBucket). Map to 404 so the client gets a clean
      // missing-asset response instead of a 500 that floods logs.
      if (upstream.status === 404) {
        return mediaError("Media not found", 404);
      }

      // Storage overloaded (disk full on rustfs volume – "Storage resources are
      // insufficient" -> 500). Return 503 so clients/CDN can retry, don't log as 500.
      if (upstream.status === 500) {
        return mediaError("Storage temporarily unavailable", 503);
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
      return mediaError("Media content not found", 404);
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
      ownership.postId && !isPrivateCommunityPost
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
    // server fault - respond like an unknown media id. Also handle missing
    // bucket (rustfs "NoSuchBucket" when "uploads" was never created or was
    // lost after a volume reset/disk-full).
    if (
      error instanceof S3ServiceException &&
      (error.name === "NoSuchKey" ||
        error.name === "NoSuchBucket" ||
        error.$metadata.httpStatusCode === 404)
    ) {
      return mediaError("Media not found", 404);
    }
    if (
      error instanceof S3ServiceException &&
      (error.name === "InternalError" ||
        error.$metadata.httpStatusCode === 500) &&
      String((error as unknown as { message?: string }).message ?? "").includes(
        "Storage resources are insufficient"
      )
    ) {
      return mediaError("Storage temporarily unavailable", 503);
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
    return mediaError("Internal Server Error", 500);
  }
}

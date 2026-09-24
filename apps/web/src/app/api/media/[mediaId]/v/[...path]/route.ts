import { and, canViewCommunity, prisma } from "@asm/db";
import { hlsBaseFromMasterKey } from "@asm/media";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  decideMediaAccess,
  resolveOwningCommunity,
} from "@/lib/media/media-access";
import { mediaError } from "@/lib/media/media-responses";
import {
  DERIVATIVE_MIME_BY_EXT,
  parseVariantRequest,
} from "@/lib/media/media-variants";
import { resolveMessageMediaMembership } from "@/lib/media/message-media-access";
import {
  ASMOB_BUCKET,
  asmobClient,
  generatePresignedUrl,
} from "@/lib/media/object-storage";
import { getWebLogger } from "@/lib/otel";

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

// Storage answers a missing object with NoSuchKey (HTTP 404). Distinguishing
// it from real faults lets serving routes return a client-facing 404 while
// genuinely broken storage surfaces as a 500.
function isObjectNotFoundError(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) {
    return false;
  }
  return error.name === "NoSuchKey" || error.$metadata.httpStatusCode === 404;
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ mediaId: string; path: string[] }>;
  }
): Promise<Response> {
  const { mediaId, path: rawPath } = await context.params;
  if (!mediaId || !Array.isArray(rawPath)) {
    return mediaError("Not found", 400);
  }

  // Ownership/visibility is read fresh (never cached), mirroring the main
  // serving route.
  const ownership = await prisma.orm.public.PostMedia.select(
    "commentId",
    "detectedMime",
    "key",
    "messageConversationId",
    "mimeType",
    "postId",
    "publishedKey",
    "status",
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
    .where({ id: mediaId })
    .first();
  const mappedOwnership = ownership
    ? {
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
      }
    : null;
  if (!mappedOwnership || mappedOwnership.status !== "READY") {
    return mediaError("Media not found", 404);
  }
  const session = await getSessionFromApi();
  const viewer = session?.user ?? null;
  const isConversationMember = await resolveMessageMediaMembership(
    mappedOwnership.messageConversationId,
    viewer?.id
  );
  const owningCommunity = resolveOwningCommunity(mappedOwnership);
  const isPrivateCommunityPost = owningCommunity?.type === "PRIVATE";
  const isCommunityMember =
    isPrivateCommunityPost && owningCommunity
      ? await canViewCommunity(owningCommunity, viewer?.id ?? "")
      : false;
  const decision = decideMediaAccess(
    {
      commentId: mappedOwnership.commentId,
      isPrivateCommunityPost,
      messageConversationId: mappedOwnership.messageConversationId,
      postId: mappedOwnership.postId,
      userId: mappedOwnership.userId,
    },
    viewer,
    {
      isCommunityMember,
      isConversationMember,
    }
  );
  if (!decision.allowed) {
    return mediaError("Media not found", decision.status);
  }

  const parsed = parseVariantRequest(rawPath);
  if (!parsed) {
    return mediaError("Not found", 404);
  }

  try {
    let objectKey: string | null = null;

    if ("hlsFile" in parsed) {
      const master = await prisma.orm.public.PostMediaDerivatives.select("key")
        .where((derivative) =>
          and(
            derivative.kind.eq("hls"),
            derivative.mediaId.eq(mediaId),
            derivative.variant.eq("master")
          )
        )
        .first();
      if (!master) {
        return mediaError("Not found", 404);
      }
      objectKey = `${hlsBaseFromMasterKey(master.key)}/${parsed.hlsFile}`;
    } else {
      const derivative = await prisma.orm.public.PostMediaDerivatives.select(
        "key"
      )
        .where((candidate) =>
          and(
            candidate.kind.eq(parsed.kind),
            candidate.mediaId.eq(mediaId),
            candidate.variant.eq(parsed.variant)
          )
        )
        .first();
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
      if (mappedOwnership.status !== "READY") {
        return mediaError("Not found", 404);
      }
      objectKey = mappedOwnership.publishedKey ?? (mappedOwnership.key || null);
      if (!objectKey) {
        return mediaError("Not found", 404);
      }
      mimeType =
        mappedOwnership.detectedMime ??
        mappedOwnership.mimeType ??
        "application/octet-stream";
    }

    const range = request.headers.get("range") || undefined;

    let body: ReadableStream<Uint8Array>;
    let status = 200;
    const headers = new Headers();
    headers.set("Content-Type", mimeType);
    // Only public post-linked media is immutable and safe to share-cache.
    // Everything else is viewer-gated - message media (membership + blocks can
    // be revoked at any time), a private community's media, and comment/draft
    // media - so it must never be stored: a cached copy would keep serving
    // after a block, unfriend, deletion, or membership revocation. This mirrors
    // the main serving route's policy so the two cannot drift.
    const cacheControl =
      mappedOwnership.postId && !isPrivateCommunityPost
        ? "public, max-age=31536000, immutable, stale-while-revalidate=86400"
        : "private, no-store";
    headers.set("Cache-Control", cacheControl);
    // HLS playlists must not be cached aggressively by shared caches so
    // takedowns propagate quickly; segments are content-addressed anyway. Only
    // public (post-linked) media may use the shared cache.
    if (
      objectKey.endsWith(".m3u8") &&
      mappedOwnership.postId &&
      !isPrivateCommunityPost
    ) {
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
        return mediaError("Not found", 404);
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
    // A READY row whose fallback/original bytes are gone from storage (crash
    // between publish and upload, corrupted duplicate rows) is a missing
    // asset, not a server fault - clients get the same shape as an unknown
    // media id.
    if (isObjectNotFoundError(error)) {
      return mediaError("Not found", 404);
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

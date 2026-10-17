import {
  activateViewOnceGrant,
  ChatLifecycleError,
  consumeRateLimit,
  releaseViewOnceGrant,
  reserveViewOnceMedia,
} from "@asm/db";
import { isUuid } from "@asm/messages";
import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";

import { getSessionFromApi } from "@/lib/auth/session";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

const VIEW_ONCE_IMAGE_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface Context {
  params: Promise<{ id: string; mediaId: string }>;
}

function errorResponse(error: unknown): Response {
  if (error instanceof ChatLifecycleError) {
    let message = "This photo is no longer available";
    if (error.code === "VIEW_ONCE_CONSUMED") {
      message = "This photo has already been opened";
    } else if (error.code === "VIEW_ONCE_OPENING") {
      message = "This photo is already opening";
    }
    return Response.json(
      { code: error.code, error: message },
      {
        headers: { "Cache-Control": "private, no-store" },
        status: error.status,
      }
    );
  }
  return Response.json(
    { error: "This photo couldn't be opened. Try again." },
    { headers: { "Cache-Control": "private, no-store" }, status: 503 }
  );
}

async function openRequest(request: Request, context: Context) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: conversationId, mediaId } = await context.params;
  const grantId = request.headers.get("X-View-Once-Grant");
  if (!isUuid(grantId)) {
    return Response.json({ error: "Invalid view request" }, { status: 400 });
  }
  const budget = await consumeRateLimit({
    bucket: "message-view-once-open",
    identifier: user.id,
    limit: 240,
    windowSeconds: 60,
  });
  if (!budget.allowed) {
    return Response.json(
      { error: "Try again in a moment" },
      { headers: { "Cache-Control": "private, no-store" }, status: 429 }
    );
  }
  return { conversationId, grantId, mediaId, userId: user.id };
}

async function releaseReservation(grantId: string, userId: string) {
  try {
    await releaseViewOnceGrant(grantId, userId);
  } catch {
    // Expired reservations are released by the cleanup worker if the database is unavailable.
  }
}

export async function GET(request: Request, context: Context) {
  const input = await openRequest(request, context);
  if (input instanceof Response) {
    return input;
  }
  const { conversationId, mediaId, userId, grantId } = input;

  let reservation: Awaited<ReturnType<typeof reserveViewOnceMedia>>;
  try {
    reservation = await reserveViewOnceMedia(
      conversationId,
      mediaId,
      userId,
      grantId
    );
  } catch (error) {
    return errorResponse(error);
  }
  if (!VIEW_ONCE_IMAGE_TYPES.has(reservation.mimeType.toLowerCase())) {
    await releaseReservation(grantId, userId);
    return Response.json(
      { error: "This photo is no longer available" },
      { status: 404 }
    );
  }

  let response: GetObjectCommandOutput;
  try {
    response = await asmobClient.send(
      new GetObjectCommand({
        Bucket: ASMOB_BUCKET,
        Key: reservation.objectKey,
      }),
      { abortSignal: request.signal }
    );
  } catch (error) {
    await releaseReservation(grantId, userId);
    if (
      error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404
    ) {
      return Response.json(
        { error: "This photo is no longer available" },
        { status: 404 }
      );
    }
    return errorResponse(error);
  }
  if (!response.Body) {
    await releaseReservation(grantId, userId);
    return Response.json(
      { error: "This photo couldn't be opened. Try again." },
      { status: 503 }
    );
  }

  const stream: ReadableStream<Uint8Array> =
    "transformToWebStream" in response.Body
      ? response.Body.transformToWebStream()
      : (response.Body as ReadableStream<Uint8Array>);
  try {
    const active = await activateViewOnceGrant(conversationId, grantId, userId);
    if (!active) {
      await stream.cancel();
      await releaseReservation(grantId, userId);
      return Response.json(
        { error: "This photo is no longer available" },
        { status: 410 }
      );
    }
  } catch (error) {
    try {
      await stream.cancel();
    } catch {
      // The source stream may already be closed by the storage client.
    }
    await releaseReservation(grantId, userId);
    return errorResponse(error);
  }

  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      ...(response.ContentLength === undefined
        ? {}
        : { "Content-Length": String(response.ContentLength) }),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": reservation.mimeType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request, context: Context) {
  const input = await openRequest(request, context);
  if (input instanceof Response) {
    return input;
  }
  const { conversationId, mediaId, userId, grantId } = input;
  try {
    await reserveViewOnceMedia(conversationId, mediaId, userId, grantId);
    return Response.json(
      { ready: true },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

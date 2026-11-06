import {
  acknowledgeViewOnceSeen,
  ChatLifecycleError,
  consumeRateLimit,
  getViewOnceReceipt,
  publishMessageEvent,
} from "@asm/db";
import { isUuid } from "@asm/messages";

import { getSessionFromApi } from "@/lib/auth/session";
import { parseBoundedJsonBody } from "@/lib/messages/server";

interface Context {
  params: Promise<{ id: string; mediaId: string }>;
}
const privateHeaders = { "Cache-Control": "private, no-store" };

async function handle(request: Request, context: Context) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json(
      { error: "Unauthorized" },
      { headers: privateHeaders, status: 401 }
    );
  }
  const { id, mediaId } = await context.params;
  if (!isUuid(id) || !isUuid(mediaId)) {
    return Response.json(
      { error: "Invalid photo" },
      { headers: privateHeaders, status: 400 }
    );
  }
  const budget = await consumeRateLimit({
    bucket: `view-once-receipt-${request.method}`,
    identifier: user.id,
    limit: request.method === "GET" ? 600 : 240,
    windowSeconds: 60,
  });
  if (!budget.allowed) {
    return Response.json(
      { error: "Try again in a moment" },
      { headers: privateHeaders, status: 429 }
    );
  }
  try {
    if (request.method === "GET") {
      return Response.json(await getViewOnceReceipt(id, mediaId, user.id), {
        headers: privateHeaders,
      });
    }
    let body: unknown;
    try {
      body = await parseBoundedJsonBody(request, 1024);
    } catch {
      return Response.json(
        { error: "Invalid view request" },
        { headers: privateHeaders, status: 400 }
      );
    }
    const grantId =
      typeof body === "object" && body !== null && "grantId" in body
        ? body.grantId
        : null;
    if (!isUuid(grantId)) {
      return Response.json(
        { error: "Invalid view request" },
        { headers: privateHeaders, status: 400 }
      );
    }
    const result = await acknowledgeViewOnceSeen(id, mediaId, user.id, grantId);
    if (result.changed) {
      await publishMessageEvent({
        conversationId: id,
        kind: "media.viewOnce.seen",
        mediaId,
      });
    }
    return Response.json(
      { seenAt: result.seenAt, unavailable: true },
      { headers: privateHeaders }
    );
  } catch (error) {
    return Response.json(
      { error: "Couldn't update this photo" },
      {
        headers: privateHeaders,
        status: error instanceof ChatLifecycleError ? error.status : 503,
      }
    );
  }
}
export const GET = handle;
export const POST = handle;

import { requestChatExport } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { consumeDenRateLimit } from "@/lib/messages/den-rate-limit";
import { lifecycleError } from "@/lib/messages/lifecycle-api";
import {
  getConversationForUser,
  parseBoundedJsonBody,
} from "@/lib/messages/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const awaitedChatState0 = await getSessionFromApi();
  const user = awaitedChatState0?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(
    { bucket: "chat-export", limit: 5, window: "fixed", windowSeconds: 3600 },
    user.id
  );
  if (limited) {
    return limited;
  }
  const { id } = await context.params;
  try {
    if (!(await getConversationForUser(id, user.id))) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
    const body = await parseBoundedJsonBody(request, 16_000);
    if (
      !body ||
      typeof body !== "object" ||
      !("includeMedia" in body) ||
      typeof body.includeMedia !== "boolean"
    ) {
      return Response.json({ error: "Choose export options" }, { status: 400 });
    }
    const from = "fromDate" in body ? body.fromDate : undefined;
    const to = "toDate" in body ? body.toDate : undefined;
    if (
      (from !== undefined && typeof from !== "string") ||
      (to !== undefined && typeof to !== "string")
    ) {
      return Response.json({ error: "Invalid date range" }, { status: 400 });
    }
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (
      (fromDate && !Number.isFinite(fromDate.getTime())) ||
      (toDate && !Number.isFinite(toDate.getTime())) ||
      (fromDate && toDate && fromDate > toDate)
    ) {
      return Response.json(
        { error: "Choose a valid date range" },
        { status: 400 }
      );
    }
    return Response.json(
      await requestChatExport(id, user.id, {
        fromDate,
        includeMedia: body.includeMedia,
        toDate,
      }),
      {
        headers: { "Cache-Control": "private, no-store", "Retry-After": "5" },
        status: 202,
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    return lifecycleError(error);
  }
}

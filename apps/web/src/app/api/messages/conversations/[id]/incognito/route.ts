import {
  ChatLifecycleError,
  listIncognitoMessages,
  sendIncognitoMessage,
  publishChatLifecycleChange,
} from "@asm/db";
import { isUuid, LIFECYCLE_CAPABILITY, validCiphertext } from "@asm/messages";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  consumeDenRateLimit,
  DEN_MESSAGE_SEND_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { lifecycleError } from "@/lib/messages/lifecycle-api";
import {
  getConversationForUser,
  parseBoundedJsonBody,
} from "@/lib/messages/server";

interface Context {
  params: Promise<{ id: string }>;
}
export async function GET(request: Request, context: Context) {
  const awaitedChatState0 = await getSessionFromApi();
  const user = awaitedChatState0?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(
    {
      bucket: "incognito-page",
      limit: 600,
      window: "fixed",
      windowSeconds: 60,
    },
    user.id
  );
  if (limited) {
    return limited;
  }
  if (request.headers.get("X-Chat-Capability") !== LIFECYCLE_CAPABILITY) {
    return Response.json(
      { error: "Update the app to use incognito" },
      { status: 426 }
    );
  }
  const { id } = await context.params;
  try {
    if (!(await getConversationForUser(id, user.id))) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const before = url.searchParams.get("before");
    const sequence = before === null ? undefined : Number(before);
    if (
      !isUuid(sessionId) ||
      (sequence !== undefined &&
        (!Number.isSafeInteger(sequence) || sequence < 0))
    ) {
      return Response.json({ error: "Invalid page" }, { status: 400 });
    }
    return Response.json(
      await listIncognitoMessages(id, user.id, sessionId, sequence),
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return lifecycleError(error);
  }
}

export async function POST(request: Request, context: Context) {
  const awaitedChatState1 = await getSessionFromApi();
  const user = awaitedChatState1?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(
    DEN_MESSAGE_SEND_RATE_LIMIT,
    user.id
  );
  if (limited) {
    return limited;
  }
  if (request.headers.get("X-Chat-Capability") !== LIFECYCLE_CAPABILITY) {
    return Response.json(
      { error: "Update the app to use incognito" },
      { status: 426 }
    );
  }
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 100_000);
  } catch {
    return Response.json({ error: "Message is too large" }, { status: 413 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("id" in body) ||
    !isUuid(body.id) ||
    !("sessionId" in body) ||
    !isUuid(body.sessionId) ||
    !("ciphertext" in body) ||
    !validCiphertext(body.ciphertext) ||
    !("iv" in body) ||
    typeof body.iv !== "string" ||
    !/^[A-Za-z0-9+/]{16}$/u.test(body.iv) ||
    !("ratchetIndex" in body) ||
    typeof body.ratchetIndex !== "number" ||
    !Number.isSafeInteger(body.ratchetIndex) ||
    body.ratchetIndex < 0 ||
    body.ratchetIndex >= 2_147_483_647 ||
    !("keyEpoch" in body) ||
    typeof body.keyEpoch !== "number" ||
    !Number.isSafeInteger(body.keyEpoch) ||
    body.keyEpoch < 1
  ) {
    return Response.json({ error: "Invalid message" }, { status: 400 });
  }
  const mediaIds = "mediaIds" in body ? body.mediaIds : [];
  const viewOnceMediaIds =
    "viewOnceMediaIds" in body ? body.viewOnceMediaIds : [];
  if (
    !Array.isArray(mediaIds) ||
    mediaIds.length > 10 ||
    !mediaIds.every(
      (value): value is string =>
        typeof value === "string" && value.length <= 100
    )
  ) {
    return Response.json({ error: "Invalid attachments" }, { status: 400 });
  }
  if (
    !Array.isArray(viewOnceMediaIds) ||
    viewOnceMediaIds.length > 1 ||
    !viewOnceMediaIds.every(
      (value): value is string =>
        typeof value === "string" && value.length <= 100
    ) ||
    viewOnceMediaIds.some((mediaId) => mediaIds.includes(mediaId))
  ) {
    return Response.json(
      { error: "Invalid view-once attachment" },
      { status: 400 }
    );
  }
  try {
    if (!(await getConversationForUser(id, user.id))) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
    await sendIncognitoMessage({
      ciphertext: body.ciphertext,
      conversationId: id,
      id: body.id,
      iv: body.iv,
      keyEpoch: body.keyEpoch,
      mediaIds,
      ratchetIndex: body.ratchetIndex,
      senderId: user.id,
      sessionId: body.sessionId,
      viewOnceMediaIds,
    });
    await publishChatLifecycleChange(id, true);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (
      error instanceof ChatLifecycleError &&
      error.code.startsWith("INCOGNITO_INDEX:")
    ) {
      return Response.json(
        {
          error: "Another message arrived. Retry your message.",
          expectedIndex: Number(error.code.split(":")[1]),
        },
        { status: 409 }
      );
    }
    return lifecycleError(error);
  }
}

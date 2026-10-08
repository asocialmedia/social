import {
  consumeRateLimit,
  fromPrismaDateTime,
  hydrateSearchMessageCandidates,
  listDenMembershipEvents,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import { getConversationForUser } from "@/lib/messages/server";

const MAX_BATCH_IDS = 20;
const MAX_BATCH_BODY_BYTES = 16 * 1024;
export const MAX_BATCH_RESPONSE_BYTES = 1024 * 1024;

interface HydrationRequest {
  messages: { id: string; revision: number }[];
}

type BodyReadResult =
  | { status: "ok"; text: string }
  | { status: "too-large" }
  | { status: "failed" };

async function readBoundedBody(request: Request): Promise<BodyReadResult> {
  if (!request.body) {
    return { status: "ok", text: "" };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- each read bounds one chunk before retaining it.
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_BATCH_BODY_BYTES) {
        // oxlint-disable-next-line no-await-in-loop -- stop reading immediately after the hard limit.
        await reader.cancel();
        return { status: "too-large" };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: "ok", text: new TextDecoder().decode(bytes) };
  } catch {
    await reader.cancel().catch(() => {});
    return { status: "failed" };
  }
}

function isHydrationMessage(
  value: unknown
): value is { id: string; revision: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    row.id.length <= 128 &&
    typeof row.revision === "number" &&
    Number.isSafeInteger(row.revision) &&
    row.revision <= 2_147_483_647 &&
    row.revision > 0
  );
}

function isHydrationRequest(value: unknown): value is HydrationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const { messages } = value as Record<string, unknown>;
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_BATCH_IDS &&
    messages.every(isHydrationMessage)
  );
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    bucket: "message-batch-hydration",
    identifier: user.id,
    limit: 120,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Please wait before loading search results" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      }
    );
  }

  const { id: conversationId } = await ctx.params;
  let conversation;
  try {
    conversation = await getConversationForUser(conversationId, user.id);
  } catch {
    return Response.json(
      {
        error: "Search results are temporarily unavailable. Please try again.",
      },
      { status: 503 }
    );
  }
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BATCH_BODY_BYTES) {
    return Response.json({ error: "Request is too large" }, { status: 413 });
  }

  const bodyRead = await readBoundedBody(request);
  if (bodyRead.status === "failed") {
    return Response.json(
      { error: "Invalid hydration request" },
      { status: 400 }
    );
  }
  if (bodyRead.status === "too-large") {
    return Response.json({ error: "Request is too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyRead.text);
  } catch {
    return Response.json(
      { error: "Invalid hydration request" },
      { status: 400 }
    );
  }
  if (!isHydrationRequest(body)) {
    return Response.json(
      { error: "Choose between 1 and 20 valid search results" },
      { status: 400 }
    );
  }
  if (
    new Set(body.messages.map((message) => message.id)).size !==
    body.messages.length
  ) {
    return Response.json(
      { error: "Duplicate message ids are not allowed" },
      { status: 400 }
    );
  }

  const member = conversation.members.find(
    (candidate) => candidate.userId === user.id
  );
  if (!member) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const membershipEvents =
      conversation.type === "DEN"
        ? await listDenMembershipEvents(conversationId, member.leftAt ?? null)
        : [];
    const membershipWindows = readerMessageWindows({
      conversationType: conversation.type,
      events: membershipEvents,
      membership: {
        createdAt: fromPrismaDateTime(member.createdAt),
        leftAt: member.leftAt,
      },
      userId: user.id,
    });
    const rows = await hydrateSearchMessageCandidates({
      conversationId,
      membershipWindows,
      messages: body.messages,
      userId: user.id,
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const hydrated: typeof rows = [];
    const unavailableIds: string[] = [];
    const deferredIds: string[] = [];
    let responseTooLarge = false;

    for (const requested of body.messages) {
      const row = rowsById.get(requested.id);
      if (!row) {
        unavailableIds.push(requested.id);
        continue;
      }
      if (responseTooLarge) {
        deferredIds.push(requested.id);
        continue;
      }
      const candidate = [...hydrated, row];
      const responseBody = {
        deferredIds: [],
        messages: candidate,
        unavailableIds,
      };
      const candidateSize = new TextEncoder().encode(
        JSON.stringify(responseBody)
      ).byteLength;
      if (candidateSize > MAX_BATCH_RESPONSE_BYTES - 4096) {
        if (hydrated.length === 0) {
          return Response.json(
            { error: "A search result exceeds the hydration limit" },
            { status: 413 }
          );
        }
        responseTooLarge = true;
        deferredIds.push(requested.id);
        continue;
      }
      hydrated.push(row);
    }

    const requestOrder = new Map(
      body.messages.map((message, index) => [message.id, index])
    );
    let responseBody = { deferredIds, messages: hydrated, unavailableIds };
    while (
      new TextEncoder().encode(JSON.stringify(responseBody)).byteLength >
        MAX_BATCH_RESPONSE_BYTES &&
      hydrated.length > 0
    ) {
      const deferred = hydrated.pop();
      if (deferred) {
        deferredIds.push(deferred.id);
      }
      deferredIds.sort(
        (left, right) =>
          (requestOrder.get(left) ?? 0) - (requestOrder.get(right) ?? 0)
      );
      responseBody = { deferredIds, messages: hydrated, unavailableIds };
    }
    if (
      new TextEncoder().encode(JSON.stringify(responseBody)).byteLength >
      MAX_BATCH_RESPONSE_BYTES
    ) {
      return Response.json(
        { error: "A search result exceeds the hydration limit" },
        { status: 413 }
      );
    }
    return Response.json(responseBody, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error: "Search results are temporarily unavailable. Please try again.",
      },
      { status: 503 }
    );
  }
}

import { subscribeToChannel } from "@asm/db";
import { observeChatTask } from "@asm/messages";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  consumeDenRateLimit,
  DEN_STREAM_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import {
  getConversationForUser,
  isConversationMember,
} from "@/lib/messages/server";

function idleCleanup() {
  // Replaced when the stream starts.
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const awaitedChatState0 = await getSessionFromApi();
  const user = awaitedChatState0?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(DEN_STREAM_RATE_LIMIT, user.id);
  if (limited) {
    return limited;
  }
  const { id } = await context.params;
  if (!(await getConversationForUser(id, user.id, { enforceBlocks: false }))) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const encoder = new TextEncoder();
  let cleanup = idleCleanup;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cleanup();
    },
    async start(controller) {
      let closed = false;
      let subscription:
        | Awaited<ReturnType<typeof subscribeToChannel>>
        | undefined;
      let checking = false;
      const emit = (content: string) => {
        if (closed) {
          return;
        }
        if ((controller.desiredSize ?? 1) < 0) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(content));
        } catch {
          cleanup();
        }
      };
      const timer = setInterval(async () => {
        if (checking || closed) {
          return;
        }
        checking = true;
        try {
          if (await isConversationMember(id, user.id)) {
            emit(": heartbeat\n\n");
          } else {
            cleanup();
          }
        } catch {
          cleanup();
        } finally {
          checking = false;
        }
      }, 15_000);
      cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(timer);
        request.signal.removeEventListener("abort", cleanup);
        if (subscription) {
          void observeChatTask(
            subscription.unsubscribe(),
            idleCleanup,
            idleCleanup
          );
        }
        try {
          controller.close();
        } catch {
          // Reconcile safely on the next request; do not expose source errors.
        }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) {
        cleanup();
        return;
      }
      try {
        subscription = await subscribeToChannel(
          `chat-lifecycle:${id}`,
          (signal) =>
            emit(
              `event: message\ndata: ${JSON.stringify({ conversationId: id, kind: signal === "message" ? "keys.rotated" : "conversation.appearance.changed" })}\n\n`
            )
        );
        if (closed) {
          await subscription.unsubscribe();
          return;
        }
        emit("event: connected\ndata: {}\n\n");
        emit(
          `event: message\ndata: ${JSON.stringify({ conversationId: id, kind: "conversation.appearance.changed" })}\n\n`
        );
      } catch {
        cleanup();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}

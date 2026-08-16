import {
  messageChannel,
  parseMessageEvent,
  serializeMessageEvent,
  subscribeToChannel,
} from "@asm/db";

import { getConversationForUser } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

// Server-Sent Events fan-out for real-time DMs, mirroring the comments stack.
// Every message write is published to the conversation's Redis channel; each
// open stream here subscribes and forwards events to the browser. Ciphertext
// is safe to broadcast over pub/sub — the plaintext never leaves the client.
// All streams share one Redis subscriber connection per process via
// subscribeToChannel, so open threads do not each hold a connection.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Guard membership before opening the stream so non-members cannot listen.
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const channel = messageChannel(id);
  const encoder = new TextEncoder();

  let cleanup: () => void = noopCleanup;

  const stream = new ReadableStream({
    cancel() {
      cleanup();
    },
    async start(controller) {
      let closed = false;
      let subscription: Awaited<ReturnType<typeof subscribeToChannel>> | null =
        null;

      const close = async () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        if (subscription) {
          try {
            await subscription.unsubscribe();
          } catch {
            // Non-fatal.
          }
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      const onMessage = (_chan: string, raw: string) => {
        const event = parseMessageEvent(raw);
        if (!event) {
          return;
        }
        // A user's own typing/read echoes carry no information on their own
        // stream; drop them before the fan-out so every open tab on this
        // conversation skips the redundant work.
        if (
          (event.kind === "typing.started" ||
            event.kind === "conversation.read") &&
          event.userId === user.id
        ) {
          return;
        }
        try {
          // Re-serialize the validated event so the wire shape is the
          // canonical normalized one, never whatever bytes arrived.
          const normalized = serializeMessageEvent(event);
          controller.enqueue(
            encoder.encode(`event: message\ndata: ${normalized}\n\n`)
          );
        } catch {
          void close();
        }
      };

      // Keep-alive through proxies and detect dead sockets so the shared
      // subscriber slot is released.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          void close();
        }
      }, 20_000);

      cleanup = () => {
        void close();
      };
      request.signal.addEventListener(
        "abort",
        () => {
          void close();
        },
        { once: true }
      );

      try {
        subscription = await subscribeToChannel(channel, onMessage);
        controller.enqueue(
          encoder.encode(
            `event: connected\ndata: {"conversationId":"${id}"}\n\n`
          )
        );
      } catch (error) {
        console.error("Failed to subscribe to message channel:", error);
        await close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}

function noopCleanup() {
  // placeholder replaced by the stream start handler
}

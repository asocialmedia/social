import {
  messageActivityChannel,
  parseMessageActivityEvent,
  serializeMessageActivityEvent,
  subscribeToChannel,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  DEN_ACTIVITY_STREAM_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

// A user's own stream of "a message landed in one of your conversations".
//
// The transcript has its own stream per OPEN conversation; this one exists for the
// conversation list, which by definition is about the conversations nobody has
// open. It carries no message content -- only which conversation moved -- because
// the list's job is to reorder itself and re-read the preview, not to render the
// message.
//
// Mirrors the session-events stream: one Redis subscriber per process via
// subscribeToChannel, a heartbeat so proxies keep it open, and cleanup on abort.
export async function GET(request: Request): Promise<Response> {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same reasoning as the per-conversation stream, on its own bucket: this is a
  // separate subscriber on a separate channel, and a loop against one must not be
  // able to spend the other's budget. Metered before the stream is built, because
  // building it is the part that costs.
  const limited = await consumeDenRateLimit(
    DEN_ACTIVITY_STREAM_RATE_LIMIT,
    session.user.id
  );
  if (limited) {
    return limited;
  }

  const encoder = new TextEncoder();
  const channel = messageActivityChannel(session.user.id);
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
            // Non-fatal: a lost Redis connection has no remaining listener.
          }
        }
        try {
          controller.close();
        } catch {
          // The request may already have been cancelled.
        }
      };

      const onMessage = (_chan: string, raw: string) => {
        const event = parseMessageActivityEvent(raw);
        if (!event) {
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(
              `event: message-activity\ndata: ${serializeMessageActivityEvent(event)}\n\n`
            )
          );
        } catch {
          void close();
        }
      };

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
        controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
      } catch (error) {
        console.error("Failed to subscribe to the activity channel:", error);
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
  // Replaced by the stream's start handler.
}

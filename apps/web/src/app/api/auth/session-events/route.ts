import {
  parseSessionRevocationEvent,
  serializeSessionRevocationEvent,
  sessionEventChannel,
  subscribeToChannel,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(request: Request): Promise<Response> {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();
  const channel = sessionEventChannel(session.user.id);
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

      const onMessage = (_channel: string, raw: string) => {
        const event = parseSessionRevocationEvent(raw);
        if (!event) {
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(
              `event: session-revoked\ndata: ${serializeSessionRevocationEvent(event)}\n\n`
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

      // Flush headers, a reconnect policy, and a padding comment BEFORE the
      // Redis round trip. A byte-less pending request is exactly what
      // intermediaries time out and browsers report as an interrupted
      // connection, so the stream must prove it is alive immediately even if
      // the subscription stalls.
      controller.enqueue(
        encoder.encode("retry: 5000\n: session-events stream open\n\n")
      );

      try {
        subscription = await subscribeToChannel(channel, onMessage);
        controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
      } catch (error) {
        console.error("Failed to subscribe to session events:", error);
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
  // Placeholder replaced after the stream starts.
}

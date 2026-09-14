import {
  parseResponseEvent,
  subscribeToChannel,
  responseChannel,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

// Server-Sent Events fan-out for real-time responses. Every response write is
// published to the parent post's Redis channel; each open stream here
// subscribes to that channel and forwards events to the browser. Mirrors the
// eddies stream (shared Redis subscriber per process via subscribeToChannel).
export async function GET(
  request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await ctx.params;
  const channel = responseChannel(postId);
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
          // Stream may already be closed
        }
      };

      const onMessage = (_chan: string, raw: string) => {
        const event = parseResponseEvent(raw);
        if (!event) {
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(`event: response\ndata: ${raw}\n\n`)
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
        controller.enqueue(
          encoder.encode(`event: connected\ndata: {"postId":"${postId}"}\n\n`)
        );
      } catch (error) {
        console.error("Failed to subscribe to response channel:", error);
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
  // no-op placeholder replaced by the stream start handler
}

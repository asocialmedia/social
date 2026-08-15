import { commentChannel, parseCommentEvent, subscribeToChannel } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

// Server-Sent Events fan-out for real-time eddies. Every comment write is
// published to the post's Redis channel; each open stream here subscribes to
// that channel and forwards events to the browser. Pub/sub (rather than a
// poll or a list) means a single write reaches every subscriber on every web
// instance. All streams share one Redis subscriber connection per process via
// subscribeToChannel, so viewers do not each hold a connection.
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
  const channel = commentChannel(postId);
  const encoder = new TextEncoder();

  // Placeholder cleanup replaced once the stream starts; defined at module
  // scope so the initial value doesn't capture anything.
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
        const event = parseCommentEvent(raw);
        if (!event) {
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(`event: comment\ndata: ${raw}\n\n`)
          );
        } catch {
          void close();
        }
      };

      // Keep the connection alive through proxies and detect dead sockets so
      // the shared subscriber slot is released.
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
        console.error("Failed to subscribe to comment channel:", error);
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

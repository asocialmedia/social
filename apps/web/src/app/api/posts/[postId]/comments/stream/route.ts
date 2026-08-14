import {
  commentChannel,
  createSubscriberConnection,
  parseCommentEvent,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

// Server-Sent Events fan-out for real-time eddies. Every comment write is
// published to the post's Redis channel; each open stream here subscribes to
// that channel and forwards events to the browser. Pub/sub (rather than a
// poll or a list) means a single write reaches every subscriber on every web
// instance, and the subscription is cheap: one ioredis subscriber per viewer.
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
      const subscriber = createSubscriberConnection();

      const close = async () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        subscriber.removeListener("message", onMessage);
        try {
          await subscriber.unsubscribe(channel);
        } catch {
          // Unsubscribe failures are non-fatal; proceed to quit.
        }
        try {
          await subscriber.quit();
        } catch {
          // The connection may already be gone.
        }
        try {
          controller.close();
        } catch {
          // Stream may already be closed
        }
      };

      const onMessage = (chan: string, message: string) => {
        if (chan !== channel) {
          return;
        }
        const event = parseCommentEvent(message);
        if (!event) {
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(`event: comment\ndata: ${message}\n\n`)
          );
        } catch {
          void close();
        }
      };

      // Keep the connection alive through proxies and detect dead sockets so
      // the subscriber connection is not leaked.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          void close();
        }
      }, 20_000);

      subscriber.on("message", onMessage);

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
        await subscriber.subscribe(channel);
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

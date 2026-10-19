// oxlint-disable promise/prefer-await-to-then
import {
  externalFollowAuthors,
  getNetworkPersona,
  redis,
  subscribeToChannel,
} from "@asm/db";
import {
  DISCOVERY_WATCH_CHANNEL,
  FEED_EVENTS_CHANNEL,
  discoveryLocaleSchema,
  feedChangeSchema,
} from "@asm/protocols/discovery";

import { getSessionFromApi } from "@/lib/auth/session";
import { ProtocolGatewayError, protocolRoute } from "@/lib/protocols/gateway";
import { discoveryTopics } from "@/lib/protocols/recommendations";

let openStreams = 0;
const noop = () => {
  // Replaced by the stream cleanup once it starts.
};

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async () => {
    const locale = discoveryLocaleSchema.safeParse(
      new URL(request.url).searchParams.get("locale") ?? "en"
    );
    if (!locale.success) {
      throw new ProtocolGatewayError(400, "invalid_locale");
    }
    if (openStreams >= 256) {
      throw new ProtocolGatewayError(503, "stream_capacity");
    }
    const session = await getSessionFromApi();
    const network = session?.user.id
      ? await getNetworkPersona(session.user.id).catch(() => null)
      : null;
    const topics = network
      ? discoveryTopics(
          network.profile,
          network.selected.interests,
          network.topicScope
        )
      : [];
    let followedAuthors = new Set<string>();
    if (openStreams >= 256) {
      throw new ProtocolGatewayError(503, "stream_capacity");
    }
    const encoder = new TextEncoder();
    let cleanup = noop;
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => cleanup(),
      start(controller) {
        openStreams += 1;
        let closed = false;
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        const pending = new Map<string, string>();
        let subscription:
          | Awaited<ReturnType<typeof subscribeToChannel>>
          | undefined;
        const close = () => {
          if (closed) {
            return;
          }
          closed = true;
          openStreams -= 1;
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          clearTimeout(flushTimer);
          request.signal.removeEventListener("abort", close);
          void subscription?.unsubscribe().catch(() => {
            // The shared subscriber reconnects independently.
          });
          try {
            controller.close();
          } catch {
            // The transport may already have closed.
          }
        };
        const send = (frame: string) => {
          if (closed) {
            return;
          }
          // Slow consumers reconnect and reconcile the head instead of buffering events.
          if ((controller.desiredSize ?? 0) <= 0) {
            close();
            return;
          }
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            close();
          }
        };
        const watch = async () => {
          if (session?.user.id) {
            const authors = await externalFollowAuthors(session.user.id);
            followedAuthors = new Set(authors.map((author) => author.did));
          }
          await redis.publish(
            DISCOVERY_WATCH_CHANNEL,
            JSON.stringify({ locale: locale.data, renew: true, topics })
          );
        };
        const heartbeat = setInterval(() => {
          send(": keep-alive\n\n");
          void watch().catch(close);
        }, 20_000);
        // Reconnect refreshes session interests and repairs missed pub/sub notifications.
        const lifetime = setTimeout(close, 5 * 60_000);
        cleanup = close;
        request.signal.addEventListener("abort", close, { once: true });
        if (request.signal.aborted) {
          close();
          return;
        }
        void (async () => {
          try {
            subscription = await subscribeToChannel(
              FEED_EVENTS_CHANNEL,
              (_channel, raw) => {
                try {
                  const change = feedChangeSchema.safeParse(JSON.parse(raw));
                  if (
                    change.success &&
                    (!change.data.locale || change.data.locale === locale.data)
                  ) {
                    if (
                      (change.data.source === "bluesky-following" &&
                        !session?.user.id) ||
                      (change.data.viewerId &&
                        change.data.viewerId !== session?.user.id) ||
                      (change.data.authorIds &&
                        !change.data.authorIds.some((did) =>
                          followedAuthors.has(did)
                        ))
                    ) {
                      return;
                    }
                    const {
                      authorIds: _authorIds,
                      viewerId: _viewerId,
                      ...publicChange
                    } = change.data;
                    pending.set(
                      `${publicChange.source}:${publicChange.mode ?? ""}`,
                      `event: feed\ndata: ${JSON.stringify(publicChange)}\n\n`
                    );
                    flushTimer ??= setTimeout(() => {
                      flushTimer = undefined;
                      send([...pending.values()].join(""));
                      pending.clear();
                    }, 250);
                  }
                } catch {
                  // Ignore malformed hints; post data always comes from viewer-authorized reads.
                }
              }
            );
            if (closed) {
              await subscription.unsubscribe();
              return;
            }
            await watch();
            send('retry: 3000\nevent: feed\ndata: {"source":"connected"}\n\n');
          } catch {
            close();
          }
        })();
      },
    });
    return new Response(stream, {
      headers: {
        "cache-control": "private, no-cache, no-transform",
        "content-type": "text/event-stream",
        "x-accel-buffering": "no",
      },
    });
  });
}

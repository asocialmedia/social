import {
  communityChatRedisChannel,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  getCommunityChatRoomChanges,
  getSubscriberGeneration,
  subscribeToChannel,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  communityChatAvailabilityResponse,
  communityChatErrorResponse,
} from "@/lib/communities/chat-api";
import { decodeCommunityChatLiveEvent } from "@/lib/communities/chat-events";

const MAX_REPLAY_PAGES = 5;
const REPLAY_PAGE_SIZE = 100;

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string; slug: string }> }
) {
  const unavailable = communityChatAvailabilityResponse(false);
  if (unavailable) {
    return unavailable;
  }
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const community = await getCommunityBySlug(slug);
  if (!community) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  let access: Awaited<ReturnType<typeof getCommunityChatRoomAccess>>;
  try {
    access = await getCommunityChatRoomAccess(roomId, userId);
  } catch (error) {
    return communityChatErrorResponse(error);
  }
  if (access.communityId !== community.id) {
    return Response.json({ error: "Chat room not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const initialCursor =
    request.headers.get("last-event-id") ??
    url.searchParams.get("after") ??
    "0";
  if (!/^[0-9]{1,20}$/u.test(initialCursor)) {
    return Response.json({ error: "Invalid event cursor" }, { status: 400 });
  }
  const channel = communityChatRedisChannel(roomId);
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>(
    {
      cancel() {
        cleanup?.();
      },
      async start(controller) {
        let closed = false;
        let leaseExpiresAt = Date.now() + 5000;
        let replaying = false;
        let replayRequested = false;
        let lastChangeSequence = BigInt(initialCursor);
        let subscriberGeneration = getSubscriberGeneration();
        let subscription: Awaited<
          ReturnType<typeof subscribeToChannel>
        > | null = null;
        let replayTimer: ReturnType<typeof setTimeout> | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let leaseTimer: ReturnType<typeof setInterval> | null = null;

        const enqueueChunk = (chunk: Uint8Array) => {
          if (closed) {
            return false;
          }
          if (Date.now() >= leaseExpiresAt) {
            void close(true);
            return false;
          }
          if ((controller.desiredSize ?? 0) < -32_768) {
            try {
              controller.enqueue(
                encoder.encode(
                  `event: reset\ndata: {"reason":"slow-consumer"}\n\n`
                )
              );
            } catch {
              // oxlint-disable-next-line no-void -- Stream enqueue failure cannot await asynchronous cancellation.
              void close();
              return false;
            }
            // oxlint-disable-next-line no-void -- Stream enqueue failure cannot await asynchronous cancellation.
            void close();
            return false;
          }
          try {
            controller.enqueue(chunk);
            return true;
          } catch {
            // oxlint-disable-next-line no-void -- Stream enqueue failure cannot await asynchronous cancellation.
            void close();
            return false;
          }
        };

        const enqueue = (event: string, data: unknown, id?: string) =>
          enqueueChunk(
            encoder.encode(
              `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );

        const close = async (notify = false) => {
          if (closed) {
            return;
          }
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          if (leaseTimer) {
            clearInterval(leaseTimer);
          }
          if (replayTimer) {
            clearTimeout(replayTimer);
          }
          if (subscription) {
            try {
              await subscription.unsubscribe();
            } catch {
              // The shared subscriber may already have disconnected.
            }
          }
          if (notify) {
            try {
              controller.enqueue(
                encoder.encode(
                  'event: access-revoked\ndata: {"message":"Chat access changed"}\n\n'
                )
              );
            } catch {
              // The client will reconnect and receive the authorization result.
            }
          }
          try {
            controller.close();
          } catch {
            // The stream may already be closed.
          }
        };

        const replay = async (): Promise<boolean> => {
          for (
            let pageNumber = 0;
            pageNumber < MAX_REPLAY_PAGES;
            pageNumber += 1
          ) {
            // oxlint-disable-next-line no-await-in-loop -- Replay pages are sequential because each cursor depends on the prior page.
            const page = await getCommunityChatRoomChanges({
              afterChangeSequence: lastChangeSequence.toString(),
              limit: REPLAY_PAGE_SIZE,
              roomId,
              userId,
            });
            if (page.changes.length === 0) {
              return false;
            }
            for (const change of page.changes) {
              const sequence = BigInt(change.changeSequence);
              if (sequence <= lastChangeSequence) {
                continue;
              }
              lastChangeSequence = sequence;
              if (!enqueue("change", change, change.changeSequence)) {
                return false;
              }
            }
            if (!page.hasMore) {
              return false;
            }
          }
          return true;
        };

        const scheduleReplay = () => {
          if (replaying) {
            replayRequested = true;
            return;
          }
          if (replayTimer || closed) {
            return;
          }
          replayTimer = setTimeout(async () => {
            replayTimer = null;
            replaying = true;
            replayRequested = false;
            try {
              replayRequested = (await replay()) || replayRequested;
            } catch {
              await close();
            } finally {
              replaying = false;
              if (replayRequested && !closed) {
                scheduleReplay();
              }
            }
          }, 100);
        };

        const onMessage = (receivedChannel: string, raw: string) => {
          if (receivedChannel !== channel) {
            return;
          }
          const decoded = decodeCommunityChatLiveEvent(roomId, raw);
          if (!decoded) {
            return;
          }
          const sequence = BigInt(decoded.event.changeSequence);
          if (sequence <= lastChangeSequence) {
            return;
          }
          if (!replaying && sequence === lastChangeSequence + 1n) {
            if (enqueueChunk(decoded.bytes)) {
              lastChangeSequence = sequence;
            }
          } else {
            scheduleReplay();
          }
        };

        cleanup = () => {
          // oxlint-disable-next-line no-void -- Request abort cannot await stream cleanup.
          void close();
        };
        request.signal.addEventListener("abort", cleanup, { once: true });

        try {
          subscription = await subscribeToChannel(channel, onMessage);
          subscriberGeneration = getSubscriberGeneration();
          enqueue("connected", {
            changeSequence: lastChangeSequence.toString(),
            roomId,
          });
          replaying = true;
          replayRequested = (await replay()) || replayRequested;
          replaying = false;
          if (replayRequested) {
            scheduleReplay();
          }
          heartbeat = setInterval(async () => {
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            } catch {
              await close();
            }
          }, 20_000);
          const checkLease = async () => {
            try {
              if (communityChatAvailabilityResponse()) {
                await close(true);
                return;
              }
              const nextAccess = await getCommunityChatRoomAccess(
                roomId,
                userId
              );
              if (
                nextAccess.communityId !== community.id ||
                !nextAccess.permissions.canRead
              ) {
                await close(true);
                return;
              }
              leaseExpiresAt = Date.now() + 5000;
              if (BigInt(nextAccess.room.changeSequence) > lastChangeSequence) {
                scheduleReplay();
              }
              const nextGeneration = getSubscriberGeneration();
              if (nextGeneration !== subscriberGeneration) {
                subscriberGeneration = nextGeneration;
                scheduleReplay();
              }
            } catch {
              await close(true);
            }
          };
          leaseTimer = setInterval(checkLease, 4000);
        } catch (error) {
          const response = communityChatErrorResponse(error);
          enqueue("error", await response.json());
          await close();
        }
      },
    },
    {
      highWaterMark: 256 * 1024,
      size(chunk) {
        return Math.max(chunk.byteLength, 1024);
      },
    }
  );

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}

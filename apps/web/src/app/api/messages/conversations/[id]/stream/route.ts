import {
  messageChannel,
  parseMessageEvent,
  serializeMessageEvent,
  subscribeToChannel,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { ACCESS_ENDED_MESSAGE } from "@/lib/messages/access-ended";
import {
  DEN_STREAM_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  getConversationForUser,
  hasLeftConversation,
  isConversationMember,
} from "@/lib/messages/server";

// Server-Sent Events fan-out for real-time DMs, mirroring the comments stack.
// Every message write is published to the conversation's Redis channel; each
// open stream here subscribes and forwards events to the browser. Ciphertext
// is safe to broadcast over pub/sub — the plaintext never leaves the client.
// All streams share one Redis subscriber connection per process via
// subscribeToChannel, so open threads do not each hold a connection.
//
// Membership is re-checked while the stream is open, not only when it opens.
// The gate above stops a non-member from ever connecting, but a connection that
// was legitimate a minute ago is not automatically legitimate now: a member
// removed from a den keeps the socket, and the ciphertext on that channel stays
// decryptable to them forever because their key wrap hangs off the conversation
// rather than off the membership. So a `den.membership.changed` announcement and
// every keep-alive tick re-ask the one indexed question, and a member who is no
// longer inside is told their access ended before anything else is delivered.
// Publishing is best-effort, which is exactly why the tick re-check exists: it
// closes the window even when the announcement never arrived.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Metered before the stream is constructed, because constructing it is the
  // expensive part: a request that never completes, a twenty-second interval for
  // as long as it lives, and a slot in the process's shared subscriber. The
  // budget is on OPENS rather than on a concurrent count, which is also how the
  // platforms meter this - Slack caps rtm.start at one a minute, Discord caps
  // concurrent Identify requests per five seconds.
  const limited = await consumeDenRateLimit(DEN_STREAM_RATE_LIMIT, user.id);
  if (limited) {
    return limited;
  }

  const { id } = await ctx.params;
  // Guard membership before opening the stream so non-members cannot listen.
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  // Somebody who left a den may open the conversation and read its history, and
  // must not receive a single frame of what happens next. Every message in this
  // channel is encrypted under an epoch the current roster holds and they do not,
  // so the ciphertext is not the leak - the signal is. It says somebody is here.
  if (hasLeftConversation(conversation, user.id)) {
    return Response.json(
      { code: "MEMBERSHIP_ENDED", error: ACCESS_ENDED_MESSAGE },
      { status: 403 }
    );
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

      type StreamEvent = NonNullable<ReturnType<typeof parseMessageEvent>>;

      // Writes one validated event to the browser. Re-serializes rather than
      // forwarding the bytes that arrived, so the wire shape is always the
      // canonical normalized one.
      const forward = (event: StreamEvent) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: message\ndata: ${serializeMessageEvent(event)}\n\n`
            )
          );
        } catch {
          void close();
        }
      };

      // Content frames that arrived while a membership check was in flight. They
      // are HELD, not dropped, because this connection may well still be entitled
      // to them; the buffer flushes in arrival order once the check says so.
      //
      // Capped, because a check is one indexed read and anything arriving faster
      // than that is a storm this connection is about to be torn out of anyway.
      const MAX_HELD_FRAMES = 256;
      let held: StreamEvent[] = [];

      // `open` -> delivering. `verifying` -> a membership question is in flight,
      // so content is buffered rather than forwarded. `ended` -> access is gone.
      let access: "ended" | "open" | "verifying" = "open";
      let recheckRequested = false;

      // Read through a function rather than inline: after `access` is set to
      // "verifying" here, TypeScript narrows it and would flag the "ended" check
      // below as impossible, even though `endAccess` can only run while this
      // awaited read is in flight.
      const hasEndedAccess = () => access === "ended";

      // Access ended. Announced before the close so the browser learns WHY its
      // stream stopped instead of reconnecting into a 404 forever; the client
      // hook reads this frame and stops the ladder.
      //
      // The announcement itself was already forwarded, which is deliberate and
      // leaks nothing: it names a conversation the reader already has open, the
      // actor (which may well be them), and a word from a closed set. What must
      // not reach them is CONTENT, and everything held is dropped here.
      const endAccess = () => {
        if (closed) {
          return;
        }
        access = "ended";
        held = [];
        try {
          controller.enqueue(
            encoder.encode(
              `event: membership-ended\ndata: ${JSON.stringify({ conversationId: id })}\n\n`
            )
          );
        } catch {
          // Already gone; the close below is the whole answer.
        }
        void close();
      };

      const beginMembershipCheck = () => {
        if (closed || hasEndedAccess()) {
          return;
        }
        if (access === "verifying") {
          // The read in flight may have started before this announcement
          // committed, so its answer can be older than the roster. Ask again
          // rather than trusting it.
          recheckRequested = true;
          return;
        }
        access = "verifying";
        void (async () => {
          // Null means the read itself failed, which is NOT the same answer as
          // "not a member": disconnecting a member who is still inside on a
          // database blip is the wrong trade, and the next tick asks again.
          let stillAMember: boolean | null = null;
          try {
            stillAMember = await isConversationMember(id, user.id);
          } catch (error) {
            console.error("Failed to re-check stream membership:", error);
          }
          if (closed || hasEndedAccess()) {
            return;
          }
          if (stillAMember === false) {
            endAccess();
            return;
          }
          access = "open";
          // The re-check comes before the flush on purpose: the answer that just
          // came back may predate a second announcement, and content released
          // before that is settled would be handed out on a stale "yes".
          if (recheckRequested) {
            recheckRequested = false;
            beginMembershipCheck();
          }
          const buffered = held;
          held = [];
          for (const event of buffered) {
            forward(event);
          }
        })();
      };

      const onMessage = (_chan: string, raw: string) => {
        const event = parseMessageEvent(raw);
        if (!event) {
          return;
        }
        // A den's roster moved. Deliberately not the actor's echo to drop: a
        // member who leaves is exactly the case this exists for, and their own
        // connection is the one that has to find out. Every connection on the
        // channel re-checks, and only the ones that are no longer members act.
        //
        // The conversation guard is about cost, not about correctness: the
        // channel is per conversation, so a frame for another one should never
        // arrive, but this is the one branch that spends a database read and
        // there is no reason to spend one on a frame that is not ours.
        if (
          event.kind === "den.membership.changed" &&
          event.conversationId === id
        ) {
          // Announced to the browser too: a client holding this thread open has
          // to re-read its conversation detail, because the roster is an input
          // to which epoch it may still write into. The check is started first,
          // so a content frame that lands in the gap below is held rather than
          // handed to somebody who has just been removed.
          beginMembershipCheck();
          forward(event);
          return;
        }
        // A user's own typing/read/keys echoes carry no information on their
        // own stream; drop them before the fan-out so every open tab on this
        // conversation skips the redundant work. (The actor already refetched
        // its own detail via the composer's explicit invalidation.)
        if (
          (event.kind === "typing.started" ||
            event.kind === "conversation.read" ||
            event.kind === "conversation.delivered" ||
            event.kind === "keys.rotated") &&
          event.userId === user.id
        ) {
          return;
        }
        // A membership question is in flight, so the answer is not known yet.
        // Holding is the only option that is right in both directions: dropping
        // would silently lose a message from a member who is still inside, and
        // forwarding would hand one more row of ciphertext to somebody who has
        // just been removed.
        if (access !== "open") {
          if (held.length < MAX_HELD_FRAMES) {
            held.push(event);
          }
          return;
        }
        forward(event);
      };

      // Keep-alive through proxies and detect dead sockets so the shared
      // subscriber slot is released. Doubles as the backstop for a lost
      // membership announcement, so removal is noticed within one interval even
      // when pub/sub was down at the moment it happened.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          void close();
          return;
        }
        beginMembershipCheck();
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

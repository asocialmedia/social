import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

// The per-conversation stream is the one place a removed member keeps a
// connection they are no longer entitled to. The gate at connect time is not
// enough: a member removed from a den an hour into an open thread still holds
// the socket, and the ciphertext that keeps arriving on it stays decryptable to
// them forever, because a key row hangs off the conversation rather than off the
// membership. So what is under test here is that a `den.membership.changed`
// announcement makes THIS connection re-read its own membership row and, when
// the answer is no, stop before it forwards anything else.
//
// Redis is faked at the subscribe boundary so a test can deliver a frame on a
// chosen channel, which is the only way to reach the listener without a live
// broker.

const CONVERSATION_ID = "den-stream";
const MEMBER_ID = "member-1";
const OWNER_ID = "owner-1";

type Listener = (channel: string, raw: string) => void;

const listeners = new Map<string, Set<Listener>>();
let unsubscribed = 0;

function subscribeToChannel(channel: string, listener: Listener) {
  const existing = listeners.get(channel) ?? new Set<Listener>();
  existing.add(listener);
  listeners.set(channel, existing);
  return {
    unsubscribe: () => {
      unsubscribed += 1;
      existing.delete(listener);
      return Promise.resolve();
    },
  };
}

// The real parser, captured before `@asm/db` is mocked, so the route under test
// validates payloads exactly as production does. Mocking the validator would make
// "a malformed event must not crash the handler" untestable.
const { parseMessageEvent: realParseMessageEvent } = await import("@asm/db");

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  messageChannel: (conversationId: string) => `messages:${conversationId}`,
  parseMessageEvent: realParseMessageEvent,
  serializeMessageEvent: (event: unknown) => JSON.stringify(event),
  subscribeToChannel,
}));

let sessionUserId: string | null = MEMBER_ID;
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    sessionUserId ? Promise.resolve({ user: { id: sessionUserId } }) : null,
}));

// The membership table this stream re-checks. `memberIds` is the authoritative
// roster; `probeFails` makes the read throw the way a database blip would.
let memberIds: string[] = [MEMBER_ID, OWNER_ID];
let probeFails = false;
let probeCount = 0;

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: (conversationId: string, userId: string) =>
    Promise.resolve(
      conversationId === CONVERSATION_ID && memberIds.includes(userId)
        ? { id: CONVERSATION_ID, members: [{ userId }], type: "DEN" }
        : null
    ),
  isConversationMember: (_conversationId: string, userId: string) => {
    probeCount += 1;
    if (probeFails) {
      return Promise.reject(new Error("connection terminated"));
    }
    return Promise.resolve(memberIds.includes(userId));
  },
}));

function messageFrame(ciphertext: string, id: string): string {
  return JSON.stringify({
    conversationId: CONVERSATION_ID,
    kind: "message.created",
    message: { ciphertext, id },
  });
}

function membershipEvent(action: string, actorId = OWNER_ID): string {
  return JSON.stringify({
    conversationId: CONVERSATION_ID,
    kind: "den.membership.changed",
    membershipAction: action,
    userId: actorId,
  });
}

async function openStream(): Promise<{
  delivered: () => string;
  reader: ReadableStreamDefaultReader<Uint8Array>;
}> {
  const response = await GET(new Request("http://localhost/stream"), {
    params: Promise.resolve({ id: CONVERSATION_ID }),
  });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  // Drains the body in the background, so a frame the route enqueues during a
  // test does not deadlock behind a read nobody is making. `void` rather than an
  // await: the point is that it never settles while the stream is open.
  const drain = (async () => {
    // oxlint-disable no-await-in-loop -- a stream is read one chunk at a time by definition
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      text += decoder.decode(value, { stream: true });
    }
  })();
  void drain;

  return { delivered: () => text, reader };
}

// Pushes a frame the way Redis would, then waits for the route to react.
async function publish(raw: string, channel = `messages:${CONVERSATION_ID}`) {
  for (const listener of listeners.get(channel) ?? []) {
    listener(channel, raw);
  }
  // The membership re-check is an awaited database read, so give it a turn plus
  // the promise it is waiting on.
  await Bun.sleep(20);
}

beforeEach(() => {
  listeners.clear();
  unsubscribed = 0;
  sessionUserId = MEMBER_ID;
  memberIds = [MEMBER_ID, OWNER_ID];
  probeFails = false;
  probeCount = 0;
});

describe("GET /api/messages/conversations/[id]/stream", () => {
  test("refuses a non-member before it opens a stream", async () => {
    sessionUserId = "outsider-1";
    const response = await GET(new Request("http://localhost/stream"), {
      params: Promise.resolve({ id: CONVERSATION_ID }),
    });
    expect(response.status).toBe(404);
    expect(listeners.size).toBe(0);
  });

  test("greets a member with the connected frame", async () => {
    const { delivered } = await openStream();
    await Bun.sleep(20);
    expect(delivered()).toContain("event: connected");
    expect(delivered()).toContain(`"conversationId":"${CONVERSATION_ID}"`);
  });

  test("stops delivering once the member is removed, and says so", async () => {
    const { delivered } = await openStream();
    await Bun.sleep(20);

    // Removed between connect and the announcement. The membership row is gone
    // by the time the frame is published, which is the whole reason the route
    // re-reads instead of trusting the payload.
    memberIds = [OWNER_ID];
    await publish(membershipEvent("member_removed"));

    // The announcement itself IS forwarded -- it is what makes the open thread
    // re-read its detail -- and then access ends.
    expect(delivered()).toContain('"kind":"den.membership.changed"');
    expect(delivered()).toContain("event: membership-ended");
    // The shared Redis slot is released, not leaked.
    expect(unsubscribed).toBe(1);
  });

  test("delivers nothing further after a removal", async () => {
    const { delivered, reader } = await openStream();
    await Bun.sleep(20);
    memberIds = [OWNER_ID];
    await publish(membershipEvent("member_removed"));
    const atClose = delivered().length;

    // Anything published after the close must not reach this connection. The
    // read resolves as done because the route closed the controller.
    await publish(messageFrame("after-removal", "m-late"));
    await Bun.sleep(20);
    expect(delivered().length).toBe(atClose);
    expect(delivered()).not.toContain("after-removal");

    // And the body really is finished, not just silent.
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  test("holds a content frame that races the check, and drops it when access ends", async () => {
    // The check is an awaited database read, so a message can land in the gap.
    // Forwarding it would hand one more row of ciphertext to somebody who has
    // just been removed, which is the exact leak this re-check exists to close.
    const { delivered } = await openStream();
    await Bun.sleep(20);

    memberIds = [OWNER_ID];
    const membership = membershipEvent("member_removed");
    for (const listener of listeners.get(`messages:${CONVERSATION_ID}`) ?? []) {
      listener(`messages:${CONVERSATION_ID}`, membership);
      // Same tick as the announcement, before the check has resolved.
      listener(
        `messages:${CONVERSATION_ID}`,
        messageFrame("raced-the-check", "m-raced")
      );
    }
    await Bun.sleep(40);

    expect(delivered()).toContain("event: membership-ended");
    expect(delivered()).not.toContain("raced-the-check");
  });

  test("releases a held content frame once the check says the member is still inside", async () => {
    // The other half: a member who is still in must not silently lose a message
    // because of somebody else's roster change. Held frames flush in order.
    const { delivered } = await openStream();
    await Bun.sleep(20);

    const channel = `messages:${CONVERSATION_ID}`;
    for (const listener of listeners.get(channel) ?? []) {
      listener(channel, membershipEvent("member_added"));
      listener(channel, messageFrame("first", "m-1"));
      listener(channel, messageFrame("second", "m-2"));
    }
    await Bun.sleep(40);

    expect(delivered()).not.toContain("event: membership-ended");
    expect(delivered()).toContain("first");
    expect(delivered()).toContain("second");
    // Order preserved, because the buffer is a queue and not a set.
    expect(delivered().indexOf("first")).toBeLessThan(
      delivered().indexOf("second")
    );
  });

  test("keeps the stream for a member a roster change did not remove", async () => {
    const { delivered } = await openStream();
    await Bun.sleep(20);

    // Somebody else joined. This connection is still inside, so it must keep
    // working: a membership announcement is not a disconnect signal on its own.
    await publish(membershipEvent("member_added"));
    expect(delivered()).not.toContain("event: membership-ended");
    expect(unsubscribed).toBe(0);

    await publish(messageFrame("still-here", "m-ok"));
    await Bun.sleep(20);
    expect(delivered()).toContain("still-here");
  });

  test("a malformed frame is ignored without closing the stream", async () => {
    const { delivered } = await openStream();
    await Bun.sleep(20);

    await publish("not json at all");
    await publish(
      '{"kind":"den.membership.changed","conversationId":"den-stream"}'
    );
    await publish(
      '{"kind":"den.membership.changed","conversationId":"den-stream","userId":"u","membershipAction":"everyone_vanished"}'
    );
    await publish(
      '{"kind":"totally.unknown","conversationId":"den-stream","userId":"u"}'
    );

    expect(delivered()).not.toContain("event: membership-ended");
    expect(unsubscribed).toBe(0);
    // Still live afterwards.
    await publish(messageFrame("survived", "m-survived"));
    await Bun.sleep(20);
    expect(delivered()).toContain("survived");
  });

  test("a frame for another conversation does not cost a membership check", async () => {
    const { delivered } = await openStream();
    await Bun.sleep(20);
    // The parse is validated but the frame names a different conversation, so it
    // is not this stream's business and must not query the database.
    await publish(
      JSON.stringify({
        conversationId: "some-other-den",
        kind: "den.membership.changed",
        membershipAction: "member_removed",
        userId: OWNER_ID,
      })
    );
    expect(probeCount).toBe(0);
    expect(delivered()).not.toContain("event: membership-ended");
  });

  test("a failed membership read keeps the stream rather than guessing", async () => {
    const { delivered } = await openStream();
    await Bun.sleep(20);
    probeFails = true;
    await publish(membershipEvent("member_removed"));
    // Erring towards disconnecting on a database blip would drop a member who is
    // still inside; the next tick asks again.
    expect(delivered()).not.toContain("event: membership-ended");
    expect(unsubscribed).toBe(0);
  });

  test("drops the caller's own typing and receipt echoes", async () => {
    const { delivered } = await openStream();
    await Bun.sleep(20);
    for (const payload of [
      { kind: "typing.started", userId: MEMBER_ID },
      {
        conversationId: CONVERSATION_ID,
        kind: "conversation.read",
        readAt: "2026-01-01T00:00:00.000Z",
        userId: MEMBER_ID,
      },
      {
        conversationId: CONVERSATION_ID,
        deliveredAt: "2026-01-01T00:00:00.000Z",
        kind: "conversation.delivered",
        userId: MEMBER_ID,
      },
      {
        conversationId: CONVERSATION_ID,
        kind: "den.membership.changed",
        membershipAction: "member_added",
        userId: MEMBER_ID,
      },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one frame at a time, so each wait is this frame's
      await publish(JSON.stringify(payload));
    }
    // This caller is still a member, so nothing ended. Its own typing, read and
    // receipt echoes were dropped, and its own roster change came back as a
    // membership check that passed -- never as a disconnect.
    expect(delivered()).toContain('"kind":"den.membership.changed"');
    expect(delivered()).not.toContain("event: membership-ended");
  });

  test("never drops the actor's own roster change, which is how leaving works", async () => {
    // The one echo the fan-out must NOT suppress. A member who leaves is the
    // actor of the announcement, so filtering their own event the way typing and
    // receipts are filtered would leave their connection open on a den they have
    // already left.
    const { delivered } = await openStream();
    await Bun.sleep(20);
    memberIds = [OWNER_ID];
    await publish(membershipEvent("left", MEMBER_ID));
    expect(delivered()).toContain("event: membership-ended");
  });
});

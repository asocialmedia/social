import { describe, expect, test } from "bun:test";

import {
  MEMBERSHIP_ENDED_EVENT,
  catchUpKeys,
  parseMessageEvent,
  parseServerSentFrame,
  realtimeFrameAction,
  shouldCatchUp,
} from "./use-messages-realtime";

const CONVERSATION_ID = "den-1";

// Exactly the frame the stream route writes for a roster move, so a change on
// either side shows up here rather than as a silently dead stream.
function membershipFrame(
  action: string,
  overrides: {
    conversationId?: string;
    membershipSeq?: number;
    userId?: string;
  } = {}
): string {
  return `event: message\ndata: ${JSON.stringify({
    conversationId: overrides.conversationId ?? CONVERSATION_ID,
    kind: "den.membership.changed",
    membershipAction: action,
    ...(overrides.membershipSeq === undefined
      ? {}
      : { membershipSeq: overrides.membershipSeq }),
    userId: overrides.userId ?? "owner-1",
  })}`;
}

describe("parseMessageEvent", () => {
  test("preserves the read watermark for conversation.read", () => {
    expect(
      parseMessageEvent(
        JSON.stringify({
          conversationId: "convo-1",
          kind: "conversation.read",
          readAt: "2026-01-01T00:00:00.000Z",
          userId: "u1",
        })
      )
    ).toEqual({
      conversationId: "convo-1",
      deliveredAt: undefined,
      kind: "conversation.read",
      message: undefined,
      readAt: "2026-01-01T00:00:00.000Z",
      userId: "u1",
    });
  });

  test("rejects conversation.read without a read timestamp", () => {
    expect(
      parseMessageEvent(
        JSON.stringify({
          conversationId: "convo-1",
          kind: "conversation.read",
          userId: "u1",
        })
      )
    ).toBeNull();
  });

  test("rejects conversation.delivered without a delivered timestamp", () => {
    expect(
      parseMessageEvent(
        JSON.stringify({
          conversationId: "convo-1",
          kind: "conversation.delivered",
          userId: "u1",
        })
      )
    ).toBeNull();
  });

  test("rejects unknown event kinds", () => {
    expect(
      parseMessageEvent(
        JSON.stringify({ conversationId: "convo-1", kind: "bogus" })
      )
    ).toBeNull();
    expect(parseMessageEvent("not json")).toBeNull();
  });
});

describe("parseMessageEvent and the roster counter", () => {
  test("carries a roster counter to the caller", () => {
    const parsed = parseMessageEvent(
      `{"conversationId":"den-1","kind":"den.membership.changed","membershipAction":"member_removed","membershipSeq":7,"userId":"owner-1"}`
    );
    expect(parsed?.membershipSeq).toBe(7);
  });

  test("drops a counter it cannot read, and keeps the event", () => {
    // The lenient half, and it is the half that matters: a receiver's fallback for
    // no counter is the behaviour it had before this field existed, which is a
    // refetch. Refusing the whole announcement over an unreadable number would hand
    // a member with the thread open a stale roster because a publisher sent a bad
    // value, which is the opposite of what the counter is for.
    for (const membershipSeq of [
      '"7"',
      "7.5",
      "-1",
      "null",
      '{"value":7}',
      "null",
      "1e400",
    ]) {
      const parsed = parseMessageEvent(
        `{"conversationId":"den-1","kind":"den.membership.changed","membershipAction":"member_removed","membershipSeq":${membershipSeq},"userId":"owner-1"}`
      );
      expect(parsed?.kind).toBe("den.membership.changed");
      expect(parsed?.membershipSeq).toBeUndefined();
    }
  });

  test("an announcement with no counter at all is still delivered", () => {
    // What a server that has not shipped the column sends, and what every event
    // for a dissolved den carries. Delivered, with the counter simply absent: the
    // caller keeps today's behaviour rather than assuming its roster is current.
    const parsed = parseMessageEvent(
      '{"conversationId":"den-1","kind":"den.membership.changed","membershipAction":"dissolved","userId":"owner-1"}'
    );
    expect(parsed?.kind).toBe("den.membership.changed");
    expect(parsed?.membershipSeq).toBeUndefined();
  });
});

describe("parseServerSentFrame", () => {
  test("splits event type and data", () => {
    expect(parseServerSentFrame('event: message\ndata: {"a":1}')).toEqual({
      data: '{"a":1}',
      eventType: "message",
    });
  });

  test("defaults a bare data frame to message events", () => {
    expect(parseServerSentFrame("data: hello")).toEqual({
      data: "hello",
      eventType: "message",
    });
  });

  test("surfaces the connected greeting for catch-up handling", () => {
    expect(
      parseServerSentFrame('event: connected\ndata: {"conversationId":"c"}')
    ).toEqual({
      data: '{"conversationId":"c"}',
      eventType: "connected",
    });
  });

  test("ignores heartbeat comments with no data", () => {
    expect(parseServerSentFrame(": keep-alive")).toEqual({
      data: null,
      eventType: "message",
    });
  });
});

describe("shouldCatchUp", () => {
  const now = 1_000_000;

  test("catches up when nothing has loaded yet", () => {
    expect(shouldCatchUp({ dataUpdatedAt: 0, isFetching: false, now })).toBe(
      true
    );
  });

  test("skips catch-up while a fetch is already in flight", () => {
    // The overwrite race: a reconnect must not stack a second GET whose
    // response can land after the first and replace fresh pages.
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 60_000, isFetching: true, now })
    ).toBe(false);
  });

  test("skips catch-up when data was written recently", () => {
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 2000, isFetching: false, now })
    ).toBe(false);
  });

  test("catches up once data goes stale", () => {
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 30_000, isFetching: false, now })
    ).toBe(true);
  });

  test("always reconciles on reconnect, even with freshly written data", () => {
    // The stream has no replay cursor, so a reconnect can have missed an event
    // during the gap regardless of how recently the cache was written.
    expect(
      shouldCatchUp({
        dataUpdatedAt: now - 2000,
        isFetching: false,
        isReconnect: true,
        now,
      })
    ).toBe(true);
  });

  test("still skips a reconnect while a fetch is already in flight", () => {
    // The in-flight guard is what prevents the overwrite race on reconnect.
    expect(
      shouldCatchUp({
        dataUpdatedAt: 0,
        isFetching: true,
        isReconnect: true,
        now,
      })
    ).toBe(false);
  });

  test("honours a custom minimum age", () => {
    expect(
      shouldCatchUp({
        dataUpdatedAt: now - 5000,
        isFetching: false,
        minAgeMs: 1000,
        now,
      })
    ).toBe(true);
  });
});

describe("realtimeFrameAction", () => {
  test("a roster change on the open conversation is delivered as an event", () => {
    // The caller refetches the conversation detail on this and nothing else: the
    // transcript did not change, so scroll position and an in-flight draft
    // survive.
    const action = realtimeFrameAction(
      membershipFrame("member_removed"),
      CONVERSATION_ID
    );
    expect(action.kind).toBe("event");
    expect(action.kind === "event" && action.event.kind).toBe(
      "den.membership.changed"
    );
    expect(action.kind === "event" && action.event.membershipAction).toBe(
      "member_removed"
    );
    expect(action.kind === "event" && action.event.userId).toBe("owner-1");
  });

  test("every discriminator the server can send is delivered", () => {
    for (const discriminator of [
      "created",
      "dissolved",
      "joined",
      "left",
      "member_added",
      "member_removed",
      "owner_transferred",
      "role_changed",
    ]) {
      const action = realtimeFrameAction(
        membershipFrame(discriminator),
        CONVERSATION_ID
      );
      expect(action.kind).toBe("event");
      expect(action.kind === "event" && action.event.membershipAction).toBe(
        discriminator
      );
    }
  });

  test("a roster change reaches the caller with its counter attached", () => {
    // The client-side mirror of the server gate, on the frame path the thread
    // actually reads. A counter dropped here would be a counter the gap rule never
    // sees, and the whole mechanism would silently degrade to "refetch on every
    // announcement".
    const action = realtimeFrameAction(
      membershipFrame("member_added", { membershipSeq: 3 }),
      CONVERSATION_ID
    );
    expect(action.kind === "event" && action.event.membershipSeq).toBe(3);
  });

  test("a roster change for another conversation is ignored cheaply", () => {
    // This thread's stream only carries its own conversation, so a foreign id is
    // a misbehaving publisher. It must cost the caller nothing: no event, and
    // therefore no refetch of a detail it has no stake in.
    expect(
      realtimeFrameAction(
        membershipFrame("member_removed", { conversationId: "den-2" }),
        CONVERSATION_ID
      )
    ).toEqual({ kind: "ignore" });
  });

  test("a malformed roster change is ignored rather than thrown", () => {
    // No action at all, an action outside the closed set, and no actor. Each is
    // what a broken or hostile publisher looks like, and none may reach the
    // caller as a partially-formed event.
    for (const payload of [
      '{"kind":"den.membership.changed","conversationId":"den-1"}',
      '{"kind":"den.membership.changed","conversationId":"den-1","userId":"u"}',
      '{"kind":"den.membership.changed","conversationId":"den-1","userId":"u","membershipAction":"everyone_vanished"}',
      '{"kind":"den.membership.changed","conversationId":"den-1","userId":"u","membershipAction":42}',
      "not json",
      "{}",
    ]) {
      expect(
        realtimeFrameAction(`event: message\ndata: ${payload}`, CONVERSATION_ID)
      ).toEqual({
        kind: "ignore",
      });
    }
  });

  test("the access-ended frame names the conversation it ended", () => {
    const frame = `event: ${MEMBERSHIP_ENDED_EVENT}\ndata: {"conversationId":"den-1"}`;
    expect(realtimeFrameAction(frame, CONVERSATION_ID)).toEqual({
      conversationId: CONVERSATION_ID,
      kind: "membership-ended",
    });
  });

  test("an unreadable access-ended frame still names this stream's conversation", () => {
    // The alternative is a removed member left holding a thread whose reconnect
    // ladder spins against a 404 forever, because the only signal that access
    // ended was the frame we failed to read.
    for (const data of ["", "{}", "not json"]) {
      expect(
        realtimeFrameAction(
          `event: ${MEMBERSHIP_ENDED_EVENT}\ndata: ${data}`,
          CONVERSATION_ID
        )
      ).toEqual({ conversationId: CONVERSATION_ID, kind: "membership-ended" });
    }
  });

  test("the connected greeting is its own action, not an event", () => {
    expect(
      realtimeFrameAction(
        'event: connected\ndata: {"conversationId":"den-1"}',
        CONVERSATION_ID
      )
    ).toEqual({ kind: "connected" });
  });

  test("keep-alive comments and unknown frame types are ignored", () => {
    expect(realtimeFrameAction(": keep-alive", CONVERSATION_ID)).toEqual({
      kind: "ignore",
    });
    expect(
      realtimeFrameAction(
        'event: message-activity\ndata: {"conversationId":"den-1"}',
        CONVERSATION_ID
      )
    ).toEqual({ kind: "ignore" });
  });
});

describe("catchUpKeys", () => {
  const now = 1_000_000;
  const base = {
    conversationId: CONVERSATION_ID,
    dataUpdatedAt: now - 60_000,
    isFetching: false,
    now,
  };

  test("re-reads the transcript and the detail on a reconnect", () => {
    // The detail is the only place a roster or a wrap row lives, and the stream
    // has no replay cursor, so a reconnect may have missed a membership change
    // outright. Without this the client's roster can name somebody who is out.
    expect(catchUpKeys({ ...base, isReconnect: true })).toEqual([
      ["messages", CONVERSATION_ID],
      ["message-conversation", CONVERSATION_ID],
    ]);
  });

  test("re-reads the detail on a reconnect even while a transcript fetch is in flight", () => {
    // The in-flight guard exists to stop two fetches on the SAME key racing, not
    // to make the client believe it is up to date. Skipping the detail here is
    // how a reconnect converges on a roster that moved during the gap.
    expect(
      catchUpKeys({ ...base, isFetching: true, isReconnect: true })
    ).toEqual([["message-conversation", CONVERSATION_ID]]);
  });

  test("does not re-read the detail on the first connect", () => {
    // The mount fetch covers it, and a second read on every thread open would
    // double what it costs to open a conversation.
    expect(catchUpKeys({ ...base, isReconnect: false })).toEqual([
      ["messages", CONVERSATION_ID],
    ]);
  });

  test("reads nothing when the transcript is fresh enough", () => {
    expect(
      catchUpKeys({
        ...base,
        dataUpdatedAt: now - 2000,
        isReconnect: false,
      })
    ).toEqual([]);
  });

  test("still re-reads the transcript on a first connect with no data, as before", () => {
    // `shouldCatchUp` has always answered true for a cache that has never been
    // written, and that rule is untouched: the answer stays the transcript key
    // only, because the DETAIL is what the reconnect adds.
    expect(
      catchUpKeys({ ...base, dataUpdatedAt: 0, isReconnect: false })
    ).toEqual([["messages", CONVERSATION_ID]]);
  });
});

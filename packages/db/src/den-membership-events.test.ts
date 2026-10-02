import { beforeEach, describe, expect, mock, test } from "bun:test";

// The publisher is the only thing standing between a committed membership
// mutation and a browser that still believes the old roster, so what is under
// test is the exact fan-out: which channels, what bytes, and what happens when
// there is nobody left to tell.
//
// Redis is faked rather than mocked per-call so the assertions can be about the
// wire, which is the part that is easy to get wrong and impossible to see from
// the database.

const published = mock((_channel: string, _message: string) => 1);

class FakeIoRedis {
  status = "ready";
  publish: typeof published = published;
  connect = mock(() => this);
  on = mock((_event: string, _listener: () => void) => this);
  quit = mock(() => "OK");
  subscribe = mock(() => 1);
  unsubscribe = mock(() => 1);
}

mock.module("ioredis", () => ({
  default: FakeIoRedis,
}));

const {
  DEN_MEMBERSHIP_ACTIONS,
  messageActivityChannel,
  messageChannel,
  parseMessageActivityEvent,
  parseMessageEvent,
  publishDenMembershipChanged,
  serializeMessageEvent,
} = await import("@asm/db");

function payloadOf(index: number): Record<string, unknown> {
  const [, payload] = published.mock.calls[index] as [string, string];
  return JSON.parse(payload) as Record<string, unknown>;
}

function channelsOf(): string[] {
  return published.mock.calls.map((call) => (call as [string, string])[0]);
}

describe("publishDenMembershipChanged", () => {
  beforeEach(() => {
    published.mockClear();
  });

  test("announces on the conversation channel and every member's activity channel", async () => {
    await publishDenMembershipChanged({
      action: "member_removed",
      actorId: "admin-1",
      conversationId: "den-1",
      memberIds: ["owner-1", "admin-1", "member-2"],
    });

    // The conversation channel first (open threads), then one per member whose
    // conversation list has to re-read itself.
    expect(channelsOf()).toEqual([
      "messages:den-1",
      "message-activity:owner-1",
      "message-activity:admin-1",
      "message-activity:member-2",
    ]);
    expect(published).toHaveBeenCalledTimes(4);
  });

  test("carries the conversation, the actor and the action, and nothing else", async () => {
    await publishDenMembershipChanged({
      action: "role_changed",
      actorId: "owner-1",
      conversationId: "den-1",
      memberIds: ["owner-1", "member-2"],
    });

    expect(payloadOf(0)).toEqual({
      conversationId: "den-1",
      kind: "den.membership.changed",
      membershipAction: "role_changed",
      userId: "owner-1",
    });
    // The activity frame stays as small as the message one is: a conversation id
    // and the reason to refetch, because the list is a signal consumer.
    expect(payloadOf(1)).toEqual({
      conversationId: "den-1",
      kind: "den.membership.changed",
    });
  });

  test("never puts key, ciphertext or invite-code material on the wire", async () => {
    await publishDenMembershipChanged({
      action: "created",
      actorId: "owner-1",
      conversationId: "den-1",
      memberIds: ["owner-1", "member-2"],
    });

    const wire = published.mock.calls
      .map((call) => (call as [string, string])[1])
      .join("");
    // The columns whose values would be a real disclosure if they leaked:
    // a wrap blob, a body, and the ability to add strangers.
    expect(wire).not.toContain("ciphertext");
    expect(wire).not.toContain("encryptedKey");
    expect(wire).not.toContain("inviteCode");
    expect(wire).not.toContain("message");
  });

  test("names no target, so the roster cannot be read off the event", async () => {
    await publishDenMembershipChanged({
      action: "member_removed",
      actorId: "owner-1",
      conversationId: "den-1",
      memberIds: ["owner-1", "member-2"],
    });

    // `member-2` is the removed member and rides only in the CHANNEL names,
    // which a client never sees. The payload cannot tell a receiver who left.
    expect(payloadOf(0)).not.toHaveProperty("memberIds");
    expect(payloadOf(0)).not.toHaveProperty("targetUserId");
    expect(JSON.stringify(payloadOf(0))).not.toContain("member-2");
  });

  test("publishes to the conversation channel when nobody is left to notify", async () => {
    // A den that was just dissolved: the conversation-channel fan-out still
    // reaches whoever is still connected, and there is no list to refresh.
    await publishDenMembershipChanged({
      action: "dissolved",
      actorId: "owner-1",
      conversationId: "den-1",
      memberIds: [],
    });

    expect(channelsOf()).toEqual(["messages:den-1"]);
    expect(published).toHaveBeenCalledTimes(1);
    expect(payloadOf(0)).toEqual({
      conversationId: "den-1",
      kind: "den.membership.changed",
      membershipAction: "dissolved",
      userId: "owner-1",
    });
  });

  test("a redis outage on either fan-out resolves instead of throwing", async () => {
    // The membership write has already committed. A publish failure may cost a
    // peer one stale refetch; it must never turn a committed change into an
    // error the caller would retry.
    published.mockImplementation(() => {
      throw new Error("connection lost");
    });

    await expect(
      publishDenMembershipChanged({
        action: "joined",
        actorId: "owner-1",
        conversationId: "den-1",
        memberIds: ["owner-1"],
      })
    ).resolves.toBeUndefined();
  });
});

describe("den.membership.changed parsing", () => {
  test("round-trips every discriminator the service can emit", () => {
    for (const action of DEN_MEMBERSHIP_ACTIONS) {
      const raw = serializeMessageEvent({
        conversationId: "den-1",
        kind: "den.membership.changed",
        membershipAction: action,
        userId: "owner-1",
      });
      const parsed = parseMessageEvent(raw);
      expect(parsed?.kind).toBe("den.membership.changed");
      expect(parsed?.membershipAction).toBe(action);
      expect(parsed?.userId).toBe("owner-1");
    }
  });

  test("refuses a membership announcement with no actor or an unknown action", () => {
    // A receiver branches on the action, so an unrecognised value would have
    // to be guessed at. Refusing the whole event is the safe reading.
    expect(
      parseMessageEvent(
        '{"kind":"den.membership.changed","conversationId":"c","membershipAction":"x"}'
      )
    ).toBeNull();
    expect(
      parseMessageEvent(
        '{"kind":"den.membership.changed","conversationId":"c","userId":"u","membershipAction":"everyone_vanished"}'
      )
    ).toBeNull();
  });

  test("accepts the membership kind on the activity channel", () => {
    const raw = JSON.stringify({
      conversationId: "den-1",
      kind: "den.membership.changed",
    });
    expect(parseMessageActivityEvent(raw)).toEqual({
      conversationId: "den-1",
      kind: "den.membership.changed",
    });
  });

  test("still rejects unknown activity kinds", () => {
    expect(
      parseMessageActivityEvent('{"conversationId":"c","kind":"bogus"}')
    ).toBeNull();
  });
});

describe("channel naming", () => {
  test("the publisher targets the existing message channels", () => {
    // Guards against a den-only channel sneaking in: this reuses the pipeline
    // the open thread and the conversation list already subscribe to.
    expect(messageChannel("den-1")).toBe("messages:den-1");
    expect(messageActivityChannel("owner-1")).toBe("message-activity:owner-1");
  });
});

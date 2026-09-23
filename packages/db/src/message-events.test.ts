import { beforeEach, describe, expect, mock, test } from "bun:test";

const published = mock((_channel: string, _message: string) => 1);

class FakeIoRedis {
  status = "ready";
  publish: typeof published = published;
  connect = mock(() => this);
  on = mock((_event: string, _listener: () => void) => this);
  quit = mock(() => "OK");
  subscribe = mock(() => 1);
  unsubscribe = mock(() => 1);
  duplicate = mock(() => this);
}

mock.module("ioredis", () => ({
  default: FakeIoRedis,
}));

const {
  messageChannel,
  parseMessageEvent,
  publishConversationDelivered,
  publishConversationRead,
  publishMessageCreated,
  publishMessageDeleted,
  publishMessageEdited,
  publishMessageKeysRotated,
  serializeMessageEvent,
} = await import("@asm/db");

describe("message channel naming", () => {
  test("namespaces the channel per conversation", () => {
    expect(messageChannel("convo-1")).toBe("messages:convo-1");
  });
});

describe("publishMessageCreated / publishMessageDeleted", () => {
  beforeEach(() => {
    published.mockClear();
  });

  test("publishes a serialized event to the conversation channel", async () => {
    await publishMessageCreated("convo-1", { id: "m1", senderId: "u1" });

    expect(published).toHaveBeenCalledTimes(1);
    const [channel, payload] = published.mock.calls[0] as [string, string];
    expect(channel).toBe("messages:convo-1");
    const parsed = JSON.parse(payload) as {
      conversationId: string;
      kind: string;
      message: { id: string };
    };
    expect(parsed.kind).toBe("message.created");
    expect(parsed.conversationId).toBe("convo-1");
    expect(parsed.message.id).toBe("m1");
  });

  test("deleted events carry the kind", async () => {
    await publishMessageDeleted("convo-1", { id: "m1" });
    const [, payload] = published.mock.calls.at(-1) as [string, string];
    expect(JSON.parse(payload).kind).toBe("message.deleted");
  });

  test("edited events carry the updated row and the kind", async () => {
    await publishMessageEdited("convo-1", {
      ciphertext: "new",
      editedAt: "2026-01-01T00:00:00.000Z",
      id: "m1",
    });
    const [channel, payload] = published.mock.calls.at(-1) as [string, string];
    expect(channel).toBe("messages:convo-1");
    const parsed = JSON.parse(payload) as {
      kind: string;
      message: { ciphertext: string; editedAt: string; id: string };
    };
    expect(parsed.kind).toBe("message.edited");
    expect(parsed.message).toEqual({
      ciphertext: "new",
      editedAt: "2026-01-01T00:00:00.000Z",
      id: "m1",
    });
  });

  test("survives redis failures without throwing", async () => {
    published.mockImplementationOnce(() => {
      throw new Error("connection lost");
    });

    await expect(
      publishMessageCreated("convo-1", { id: "m1" })
    ).resolves.toBeUndefined();
  });

  test("publishes a keys.rotated event with no key material", async () => {
    await publishMessageKeysRotated("convo-1", "u1");

    expect(published).toHaveBeenCalledTimes(1);
    const [channel, payload] = published.mock.calls[0] as [string, string];
    expect(channel).toBe("messages:convo-1");
    const parsed = JSON.parse(payload) as {
      conversationId: string;
      kind: string;
      message?: unknown;
      userId: string;
    };
    expect(parsed.kind).toBe("keys.rotated");
    expect(parsed.conversationId).toBe("convo-1");
    expect(parsed.userId).toBe("u1");
    // The event only tells the peer to refetch; it must never carry a wrap.
    expect(parsed.message).toBeUndefined();
  });

  test("publishes a conversation.read event with its timestamp", async () => {
    await publishConversationRead("convo-1", "u1", "2026-01-01T00:00:00.000Z");
    const [channel, payload] = published.mock.calls.at(-1) as [string, string];
    expect(channel).toBe("messages:convo-1");
    const parsed = JSON.parse(payload) as { kind: string; readAt: string };
    expect(parsed.kind).toBe("conversation.read");
    expect(parsed.readAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("publishes a conversation.delivered watermark event", async () => {
    await publishConversationDelivered(
      "convo-1",
      "u1",
      "2026-01-01T00:00:05.000Z"
    );
    const [channel, payload] = published.mock.calls.at(-1) as [string, string];
    expect(channel).toBe("messages:convo-1");
    const parsed = JSON.parse(payload) as {
      deliveredAt: string;
      kind: string;
      userId: string;
    };
    expect(parsed.kind).toBe("conversation.delivered");
    expect(parsed.userId).toBe("u1");
    expect(parsed.deliveredAt).toBe("2026-01-01T00:00:05.000Z");
  });
});

describe("message event (de)serialization", () => {
  test("serialize -> parse round-trips a created event", () => {
    const raw = serializeMessageEvent({
      conversationId: "convo-1",
      kind: "message.created",
      message: { ciphertext: "abc", id: "m1" },
    });
    expect(parseMessageEvent(raw)).toEqual({
      conversation: undefined,
      conversationId: "convo-1",
      kind: "message.created",
      message: { ciphertext: "abc", id: "m1" },
      userId: undefined,
    });
  });

  test("round-trips a conversation.read event", () => {
    const raw = serializeMessageEvent({
      conversationId: "convo-1",
      kind: "conversation.read",
      readAt: "2026-01-01T00:00:00.000Z",
      userId: "u1",
    });
    expect(parseMessageEvent(raw)).toEqual({
      conversation: undefined,
      conversationId: "convo-1",
      kind: "conversation.read",
      message: undefined,
      readAt: "2026-01-01T00:00:00.000Z",
      userId: "u1",
    });
  });

  test("round-trips a conversation.delivered event", () => {
    const raw = serializeMessageEvent({
      conversationId: "convo-1",
      deliveredAt: "2026-01-01T00:00:05.000Z",
      kind: "conversation.delivered",
      userId: "u1",
    });
    expect(parseMessageEvent(raw)).toEqual({
      conversation: undefined,
      conversationId: "convo-1",
      deliveredAt: "2026-01-01T00:00:05.000Z",
      kind: "conversation.delivered",
      message: undefined,
      userId: "u1",
    });
  });

  test("round-trips a typing.started event", () => {
    const raw = serializeMessageEvent({
      conversationId: "convo-1",
      kind: "typing.started",
      userId: "u1",
    });
    expect(parseMessageEvent(raw)).toEqual({
      conversation: undefined,
      conversationId: "convo-1",
      kind: "typing.started",
      message: undefined,
      userId: "u1",
    });
  });

  test("round-trips a message.edited event", () => {
    const raw = serializeMessageEvent({
      conversationId: "convo-1",
      kind: "message.edited",
      message: { ciphertext: "new", id: "m1" },
    });
    expect(parseMessageEvent(raw)).toEqual({
      conversation: undefined,
      conversationId: "convo-1",
      kind: "message.edited",
      message: { ciphertext: "new", id: "m1" },
      userId: undefined,
    });
  });

  test("round-trips a keys.rotated event", () => {
    const raw = serializeMessageEvent({
      conversationId: "convo-1",
      kind: "keys.rotated",
      userId: "u1",
    });
    expect(parseMessageEvent(raw)).toEqual({
      conversation: undefined,
      conversationId: "convo-1",
      kind: "keys.rotated",
      message: undefined,
      userId: "u1",
    });
  });

  test("rejects malformed payloads", () => {
    expect(parseMessageEvent("not json")).toBeNull();
    expect(parseMessageEvent('{"kind":"message.created"}')).toBeNull();
    expect(
      parseMessageEvent('{"kind":"bogus","conversationId":"c","message":{}}')
    ).toBeNull();
    // created events require the message payload
    expect(
      parseMessageEvent('{"kind":"message.created","conversationId":"c"}')
    ).toBeNull();
    // edited events require the updated message payload too
    expect(
      parseMessageEvent('{"kind":"message.edited","conversationId":"c"}')
    ).toBeNull();
    // typing events require the sender id
    expect(
      parseMessageEvent('{"kind":"typing.started","conversationId":"c"}')
    ).toBeNull();
    // read events require the read timestamp
    expect(
      parseMessageEvent(
        '{"kind":"conversation.read","conversationId":"c","userId":"u1"}'
      )
    ).toBeNull();
    // delivered events require the delivered timestamp and the acker id
    expect(
      parseMessageEvent(
        '{"kind":"conversation.delivered","conversationId":"c","userId":"u1"}'
      )
    ).toBeNull();
  });
});

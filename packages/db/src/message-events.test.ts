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
  publishMessageCreated,
  publishMessageDeleted,
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

  test("survives redis failures without throwing", async () => {
    published.mockImplementationOnce(() => {
      throw new Error("connection lost");
    });

    await expect(
      publishMessageCreated("convo-1", { id: "m1" })
    ).resolves.toBeUndefined();
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
      userId: "u1",
    });
    expect(parseMessageEvent(raw)).toEqual({
      conversation: undefined,
      conversationId: "convo-1",
      kind: "conversation.read",
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
    // typing events require the sender id
    expect(
      parseMessageEvent('{"kind":"typing.started","conversationId":"c"}')
    ).toBeNull();
  });
});

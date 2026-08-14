import { describe, expect, mock, test } from "bun:test";

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

// Mock the third-party client so the real @asm/db redis module runs against a
// fake instead of a live connection. This keeps @asm/db untouched, so other
// test files that mock the barrel are unaffected.
mock.module("ioredis", () => ({
  default: FakeIoRedis,
}));

const {
  commentChannel,
  parseCommentEvent,
  publishCommentEvent,
  serializeCommentEvent,
} = await import("@asm/db");

describe("comment channel naming", () => {
  test("namespaces the channel per post", () => {
    expect(commentChannel("post-1")).toBe("comments:post-1");
  });
});

describe("publishCommentEvent", () => {
  test("publishes a serialized event to the post channel", async () => {
    await publishCommentEvent({
      comment: { content: "hello", id: "c1" },
      kind: "comment.created",
      postId: "post-1",
    });

    expect(published).toHaveBeenCalledTimes(1);
    const [channel, payload] = published.mock.calls[0] as [string, string];
    expect(channel).toBe("comments:post-1");
    const parsed = JSON.parse(payload) as {
      comment: { id: string; content: string };
      kind: string;
      postId: string;
    };
    expect(parsed.kind).toBe("comment.created");
    expect(parsed.postId).toBe("post-1");
    expect(parsed.comment.content).toBe("hello");
  });

  test("survives redis failures without throwing", async () => {
    published.mockImplementationOnce(() => {
      throw new Error("connection lost");
    });

    await expect(
      publishCommentEvent({
        comment: { id: "c1" },
        kind: "comment.deleted",
        postId: "post-1",
      })
    ).resolves.toBeUndefined();
  });
});

describe("event (de)serialization", () => {
  test("serialize -> parse round-trips", () => {
    const raw = serializeCommentEvent({
      comment: { aura: 3, id: "c1" },
      kind: "comment.created",
      postId: "p1",
    });
    const parsed = parseCommentEvent(raw);
    expect(parsed).toEqual({
      comment: { aura: 3, id: "c1" },
      kind: "comment.created",
      postId: "p1",
    });
  });

  test("rejects malformed payloads", () => {
    expect(parseCommentEvent("not json")).toBeNull();
    expect(parseCommentEvent('{"kind":"comment.created"}')).toBeNull();
    expect(
      parseCommentEvent('{"kind":"bogus","postId":"p","comment":{}}')
    ).toBeNull();
  });
});

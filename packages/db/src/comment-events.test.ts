import { describe, expect, mock, test } from "bun:test";

const published = mock((_channel: string, _message: string) => 1);

mock.module("@asm/db", () => ({
  commentChannel: (postId: string) => `comments:${postId}`,
  publishCommentEvent: async (event: {
    comment: unknown;
    kind: "comment.created" | "comment.deleted";
    postId: string;
  }) => {
    try {
      await published(`comments:${event.postId}`, JSON.stringify(event));
    } catch {
      // Publish failures are intentionally swallowed by the real helper.
    }
  },
  redis: {
    publish: published,
  },
}));

const { commentChannel, publishCommentEvent } = await import("@asm/db");

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
  test("serialize -> parse round-trips", async () => {
    const { parseCommentEvent, serializeCommentEvent } =
      await import("./redis");
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

  test("rejects malformed payloads", async () => {
    const { parseCommentEvent } = await import("./redis");
    expect(parseCommentEvent("not json")).toBeNull();
    expect(parseCommentEvent('{"kind":"comment.created"}')).toBeNull();
    expect(
      parseCommentEvent('{"kind":"bogus","postId":"p","comment":{}}')
    ).toBeNull();
  });
});

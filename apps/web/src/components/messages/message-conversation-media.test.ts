import { describe, expect, test } from "bun:test";

import type { DecryptEntry } from "@/lib/messages/decryptor";

import type { ConversationMediaMessage } from "./message-conversation-media";
import {
  buildConversationMediaIndex,
  mediaFlatKey,
  messageIdFromFlatKey,
} from "./message-conversation-media";

function messages(...ids: string[]): ConversationMediaMessage[] {
  return ids.map((id) => ({ deletedAt: null, id }));
}

function mediaPayload(urls: string[], kind: "gif" | "image" = "image") {
  return {
    images: urls.map((url) => ({ height: 100, url, width: 200 })),
    kind,
    type: "media" as const,
  };
}

function lookup(
  entries: Record<string, DecryptEntry>
): (id: string) => DecryptEntry | undefined {
  return (id) => entries[id];
}

describe("mediaFlatKey", () => {
  test("round-trips the message id and image index", () => {
    const key = mediaFlatKey("cmabc123", 3);
    expect(key).toBe("cmabc123:3");
    expect(messageIdFromFlatKey(key)).toBe("cmabc123");
  });

  test("splits on the last separator", () => {
    expect(messageIdFromFlatKey("a:b:c:2")).toBe("a:b:c");
  });
});

describe("buildConversationMediaIndex", () => {
  test("flattens grouped albums in transcript order", () => {
    const list = messages("m1", "m2");
    const index = buildConversationMediaIndex(
      list,
      lookup({
        m1: mediaPayload(["/api/media/a", "/api/media/b"]),
        m2: mediaPayload(["/api/media/c"], "gif"),
      })
    );
    expect(index.items.map((item) => item.flatKey)).toEqual([
      "m1:0",
      "m1:1",
      "m2:0",
    ]);
    expect(index.items[0]).toMatchObject({
      imageIndex: 0,
      kind: "image",
      mediaId: "a",
      url: "/api/media/a",
    });
    expect(index.items[2]).toMatchObject({ kind: "gif", mediaId: "c" });
    expect(index.indexByKey.get("m2:0")).toBe(2);
    expect(index.revision).toBe(0);
  });

  test("normalizes a legacy single-url media payload", () => {
    const list = messages("m1");
    const index = buildConversationMediaIndex(
      list,
      lookup({
        m1: {
          height: 240,
          kind: "image",
          type: "media",
          url: "/api/media/legacy",
          width: 320,
        },
      })
    );
    expect(index.items).toHaveLength(1);
    expect(index.items[0]).toMatchObject({
      flatKey: "m1:0",
      mediaId: "legacy",
      url: "/api/media/legacy",
    });
  });

  test("skips deleted, pending, error, and non-media messages", () => {
    const list: ConversationMediaMessage[] = [
      { deletedAt: new Date(), id: "deleted" },
      { deletedAt: null, id: "pending" },
      { deletedAt: null, id: "errored" },
      { deletedAt: null, id: "text" },
      { deletedAt: null, id: "media" },
    ];
    const index = buildConversationMediaIndex(
      list,
      lookup({
        deleted: mediaPayload(["/api/media/x"]),
        errored: "error",
        media: mediaPayload(["/api/media/ok"]),
        pending: "pending",
        text: { content: "hi", type: "text" },
      })
    );
    expect(index.items.map((item) => item.messageId)).toEqual(["media"]);
  });

  test("leaves mediaId null for an external url", () => {
    const list = messages("m1");
    const index = buildConversationMediaIndex(
      list,
      lookup({ m1: mediaPayload(["https://cdn.example.com/a.png"]) })
    );
    expect(index.items[0].mediaId).toBeNull();
    expect(index.items[0].url).toBe("https://cdn.example.com/a.png");
  });

  test("reuses item identity across rebuilds for the same message array", () => {
    const list = messages("m1");
    const entries = { m1: mediaPayload(["/api/media/a"]) };
    const first = buildConversationMediaIndex(list, lookup(entries));
    const second = buildConversationMediaIndex(list, lookup(entries));
    expect(second.items[0]).toBe(first.items[0]);
  });

  test("drops cached items whose message is no longer present", () => {
    const before = messages("m1", "m2");
    const entries = {
      m1: mediaPayload(["/api/media/a"]),
      m2: mediaPayload(["/api/media/b"]),
    };
    buildConversationMediaIndex(before, lookup(entries));
    // Deleting m2 in place keeps the same array identity but removes its media.
    const deleted = before.map((message) =>
      message.id === "m2" ? { ...message, deletedAt: new Date() } : message
    );
    const after = buildConversationMediaIndex(deleted, lookup(entries));
    expect(after.items.map((item) => item.flatKey)).toEqual(["m1:0"]);
    // Re-adding m2 must build a fresh item rather than serve the pruned one.
    const restored = buildConversationMediaIndex(before, lookup(entries));
    expect(restored.items.map((item) => item.flatKey)).toEqual([
      "m1:0",
      "m2:0",
    ]);
  });

  test("carries the decryptor revision through", () => {
    const list = messages("m1");
    const index = buildConversationMediaIndex(
      list,
      lookup({ m1: mediaPayload(["/api/media/a"]) }),
      42
    );
    expect(index.revision).toBe(42);
  });

  test("returns an empty index when nothing is decrypted", () => {
    const list = messages("m1");
    const index = buildConversationMediaIndex(list, lookup({}));
    expect(index.items).toEqual([]);
    expect(index.indexByKey.size).toBe(0);
  });
});

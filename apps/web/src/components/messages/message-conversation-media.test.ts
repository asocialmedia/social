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

  test("removes items when a message is deleted in place, and restores them", () => {
    // Same array identity across calls, so the derivation memo is genuinely
    // exercised (mutating the element, not replacing the list).
    const list: ConversationMediaMessage[] = [
      { deletedAt: null, id: "m1" },
      { deletedAt: null, id: "m2" },
    ];
    const entries = {
      m1: mediaPayload(["/api/media/a"]),
      m2: mediaPayload(["/api/media/b"]),
    };
    const second = list[1] as ConversationMediaMessage;
    const [, firstM2] = buildConversationMediaIndex(
      list,
      lookup(entries)
    ).items;

    second.deletedAt = new Date();
    const after = buildConversationMediaIndex(list, lookup(entries));
    // Deletion is decided per rebuild from the row, not from the memo, so the
    // attachment leaves the index the moment its row is marked deleted.
    expect(after.items.map((item) => item.flatKey)).toEqual(["m1:0"]);

    // Undeleting brings the same item object back. The memo is keyed by the
    // payload object and holds no reference from the index, so restoring the row
    // reuses the derivation instead of rebuilding it — which is what lets a
    // memoized grid row skip re-rendering when this happens.
    second.deletedAt = null;
    const restored = buildConversationMediaIndex(list, lookup(entries));
    expect(restored.items.map((item) => item.flatKey)).toEqual([
      "m1:0",
      "m2:0",
    ]);
    expect(restored.items[1]).toBe(firstM2);
  });

  test("re-derives when an edit produces a new payload object", () => {
    // The memo is keyed by payload identity precisely because a message id
    // survives an edit: an id-keyed cache would keep serving the old album.
    const list = messages("m1");
    const before = mediaPayload(["/api/media/a"]);
    const after = mediaPayload(["/api/media/a", "/api/media/b"]);
    const first = buildConversationMediaIndex(list, lookup({ m1: before }));
    expect(first.items.map((item) => item.flatKey)).toEqual(["m1:0"]);

    const edited = buildConversationMediaIndex(list, lookup({ m1: after }));
    expect(edited.items.map((item) => item.flatKey)).toEqual(["m1:0", "m1:1"]);
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

  test("handles a 1000-image conversation in order and reuses identities", () => {
    const count = 1000;
    const list = messages(...Array.from({ length: count }, (_, i) => `m${i}`));
    const entries: Record<string, ReturnType<typeof mediaPayload>> = {};
    for (let index = 0; index < count; index += 1) {
      entries[`m${index}`] = mediaPayload([`/api/media/${index}`]);
    }

    const first = buildConversationMediaIndex(list, lookup(entries));
    expect(first.items).toHaveLength(count);
    expect(first.items[0]?.flatKey).toBe("m0:0");
    expect(first.items[999]?.flatKey).toBe("m999:0");
    expect(first.indexByKey.get("m500:0")).toBe(500);

    // A second pass over the same array must reuse every item identity, which
    // is what keeps the viewer from remounting on unrelated decrypt ticks.
    const second = buildConversationMediaIndex(list, lookup(entries));
    expect(second.items[0]).toBe(first.items[0]);
    expect(second.items[999]).toBe(first.items[999]);
  });

  test("skips a long imageless stretch while keeping media order", () => {
    const list = messages(...Array.from({ length: 1000 }, (_, i) => `m${i}`));
    const entries: Record<string, ReturnType<typeof mediaPayload>> = {};
    // Only every 100th message is media; the rest decrypt to text.
    for (let index = 0; index < 1000; index += 1) {
      if (index % 100 === 0) {
        entries[`m${index}`] = mediaPayload([`/api/media/${index}`]);
      }
    }
    const index = buildConversationMediaIndex(list, (id) => {
      const media = entries[id];
      return media ?? { content: "hi", type: "text" };
    });
    expect(index.items.map((item) => item.flatKey)).toEqual(
      Array.from({ length: 10 }, (_, i) => `m${i * 100}:0`)
    );
  });
});

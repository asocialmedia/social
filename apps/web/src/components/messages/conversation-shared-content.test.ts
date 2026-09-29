import { describe, expect, test } from "bun:test";

import type { DecryptEntry } from "@/lib/messages/decryptor";

import type { SharedContentMessage } from "./conversation-shared-content";
import {
  buildConversationSharedContentIndex,
  sharedContentFlatKey,
} from "./conversation-shared-content";

const ORIGIN = "https://asocialmedia.cc";

function messages(...ids: string[]): SharedContentMessage[] {
  return ids.map((id) => ({ deletedAt: null, id }));
}

function lookup(
  entries: Record<string, DecryptEntry>
): (id: string) => DecryptEntry | undefined {
  return (id) => entries[id];
}

function text(content: string): DecryptEntry {
  return { content, type: "text" };
}

function post(postId: string, content?: string): DecryptEntry {
  return { postId, type: "post", ...(content ? { content } : {}) };
}

describe("sharedContentFlatKey", () => {
  test("round-trips the message id and the share's position in it", () => {
    expect(sharedContentFlatKey("cmabc123", 2)).toBe("cmabc123:2");
  });
});

describe("buildConversationSharedContentIndex", () => {
  test("collects explicit post shares in transcript order", () => {
    const index = buildConversationSharedContentIndex(
      messages("m1", "m2"),
      lookup({ m1: post("p1", "look at this"), m2: post("p2") }),
      ORIGIN
    );
    expect(index.posts.map((item) => item.postId)).toEqual(["p1", "p2"]);
    expect(index.posts[0]).toMatchObject({
      caption: "look at this",
      flatKey: "m1:0",
      messageId: "m1",
    });
    expect(index.links).toEqual([]);
  });

  test("files a pasted in-app post link under posts, not links", () => {
    const index = buildConversationSharedContentIndex(
      messages("m1"),
      lookup({ m1: text(`read ${ORIGIN}/posts/p9/hello`) }),
      ORIGIN
    );
    expect(index.posts).toHaveLength(1);
    expect(index.posts[0]).toMatchObject({ postId: "p9" });
    expect(index.links).toEqual([]);
  });

  test("files an external link under links, keeping its sanitized url", () => {
    const index = buildConversationSharedContentIndex(
      messages("m1"),
      lookup({ m1: text("see https://example.com/a?utm_source=x") }),
      ORIGIN
    );
    expect(index.links).toHaveLength(1);
    expect(index.links[0]).toMatchObject({
      flatKey: "m1:0",
      messageId: "m1",
      // Tracking params are stripped by the shared extractor, so the list and the
      // bubble unfurl the exact same URL.
      url: "https://example.com/a",
    });
    expect(index.posts).toEqual([]);
  });

  test("reads a link out of a media caption", () => {
    const index = buildConversationSharedContentIndex(
      messages("m1"),
      lookup({
        m1: {
          content: "https://example.com/b",
          images: [{ url: "/api/media/a" }],
          kind: "image",
          type: "media",
        },
      }),
      ORIGIN
    );
    expect(index.links.map((item) => item.url)).toEqual([
      "https://example.com/b",
    ]);
  });

  test("numbers shares within their message, so a prepended page keeps keys", () => {
    const before = buildConversationSharedContentIndex(
      messages("m2"),
      lookup({ m2: text("https://example.com/b") }),
      ORIGIN
    );
    const after = buildConversationSharedContentIndex(
      messages("m1", "m2"),
      lookup({
        m1: text("https://example.com/a"),
        m2: text("https://example.com/b"),
      }),
      ORIGIN
    );
    // m2's link was the only share in its message, so it is "m2:0" in both
    // builds; a conversation-global counter would have renumbered it to "m2:1".
    expect(before.links[0]?.flatKey).toBe("m2:0");
    expect(after.links.find((item) => item.messageId === "m2")?.flatKey).toBe(
      "m2:0"
    );
  });

  test("splits one message's caption across both lists", () => {
    const index = buildConversationSharedContentIndex(
      messages("m1"),
      lookup({
        m1: post("p1", `${ORIGIN}/posts/p1/x and https://example.com/c`),
      }),
      ORIGIN
    );
    expect(index.posts.map((item) => item.postId)).toEqual(["p1", "p1"]);
    expect(index.links.map((item) => item.url)).toEqual([
      "https://example.com/c",
    ]);
  });

  test("skips deleted, undecrypted, and non-link payloads", () => {
    const index = buildConversationSharedContentIndex(
      [
        { deletedAt: new Date(), id: "gone" },
        { deletedAt: null, id: "pendingRow" },
        { deletedAt: null, id: "brokenRow" },
        { deletedAt: null, id: "missingRow" },
        { deletedAt: null, id: "imageOnly" },
      ],
      lookup({
        brokenRow: "error",
        gone: text("https://example.com/gone"),
        imageOnly: {
          images: [{ url: "/api/media/a" }],
          kind: "image",
          type: "media",
        },
        pendingRow: "pending",
      }),
      ORIGIN
    );
    expect(index.links).toEqual([]);
    expect(index.posts).toEqual([]);
  });

  test("reuses item identity for an unchanged message across decrypt ticks", () => {
    const list = messages("m1", "m2");
    const payloads = lookup({
      m1: post("p1"),
      m2: text("https://example.com/z"),
    });
    const first = buildConversationSharedContentIndex(
      list,
      payloads,
      ORIGIN,
      1
    );
    const second = buildConversationSharedContentIndex(
      list,
      payloads,
      ORIGIN,
      2
    );
    expect(second.posts[0]).toBe(first.posts[0]);
    expect(second.links[0]).toBe(first.links[0]);
    expect(second.revision).toBe(2);
  });

  test("re-derives when an edit produces a new payload object", () => {
    // The derivation memo is keyed by payload identity precisely because a
    // message id survives an edit: keying by id would keep serving the links the
    // message carried before the author rewrote it.
    const list = messages("m1");
    const first = buildConversationSharedContentIndex(
      list,
      lookup({ m1: text("https://example.com/old") }),
      ORIGIN
    );
    expect(first.links.map((item) => item.url)).toEqual([
      "https://example.com/old",
    ]);

    const edited = buildConversationSharedContentIndex(
      list,
      lookup({ m1: text("https://example.com/new") }),
      ORIGIN
    );
    expect(edited.links.map((item) => item.url)).toEqual([
      "https://example.com/new",
    ]);
    expect(edited.links[0]).not.toBe(first.links[0]);
  });

  test("one message id with two different payloads does not share a derivation", () => {
    // Guards the memo against the failure that would silently corrupt a list: a
    // derivation reused across different content. Fresh list instances reuse ids,
    // which is exactly what a remount or a refetch produces.
    const first = buildConversationSharedContentIndex(
      messages("m1"),
      lookup({ m1: post("p1") }),
      ORIGIN
    );
    const second = buildConversationSharedContentIndex(
      messages("m1"),
      lookup({ m1: post("p2") }),
      ORIGIN
    );
    expect(first.posts.map((item) => item.postId)).toEqual(["p1"]);
    expect(second.posts.map((item) => item.postId)).toEqual(["p2"]);
  });

  test("ignores a post link that belongs to another host", () => {
    const index = buildConversationSharedContentIndex(
      messages("m1"),
      lookup({ m1: text("https://elsewhere.example/posts/p9") }),
      ORIGIN
    );
    expect(index.posts).toEqual([]);
    expect(index.links).toHaveLength(1);
  });
});

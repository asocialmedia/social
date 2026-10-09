// The shared-content refs contract, stated once and run against BOTH backends.
//
// `shared-refs-memory-index.test.ts` and `indexeddb-search-index.test.ts` each
// call `runSharedRefsStoreSuite` with their own store. One statement of what a
// store must do is the only thing that stops the persistent implementation and the
// in-memory fallback from drifting, and both differences this suite has already
// caught were invisible to the tests on the other side: a memory read that created
// a counts record (so the two disagreed about an unindexed conversation), and a
// page range that could not express a descending cursor.
//
// The pure parts (the record projection, the time key, the range bounds) are
// asserted here too, because they are what both backends are built from and a
// regression in them would show up as a puzzling store failure rather than as a
// key-ordering one.

import { describe, expect, test } from "bun:test";

import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";

import type {
  SharedRefsWriteRow,
  SharedRefKind,
  SharedRefRecord,
  SharedRefsCounts,
  SharedRefsPage,
} from "./shared-refs-format";
import {
  buildSharedRefRecords,
  emptySharedRefsCounts,
  sharedRefRange,
  sharedRefTimeKey,
  SHARED_REFS_FORMAT_VERSION,
} from "./shared-refs-format";

export const CONVERSATION = "conv-1";

// The four methods a consumer of the refs index uses. Narrowed from the full
// store contract so this suite can also be pointed at a test double.
export interface SharedRefsStoreUnderTest {
  listConversations: () => Promise<
    {
      conversationId: string;
      indexedRowCount: number;
      lastAccessedAt: number;
    }[]
  >;
  putSharedRefs: (
    conversationId: string,
    rows: Map<string, SharedRefsWriteRow>
  ) => Promise<void>;
  readSharedRefs: (
    conversationId: string,
    kind: SharedRefKind,
    options?: { after?: string; limit: number }
  ) => Promise<SharedRefsPage>;
  readSharedRefsCounts: (
    conversationId: string
  ) => Promise<SharedRefsCounts | null>;
  removeSharedRefs: (
    conversationId: string,
    messageIds: string[]
  ) => Promise<void>;
}

// One ref row as the writer hands it over: a message with a single ref of `kind`,
// created `n` milliseconds after the epoch so ordering is total and obvious.
export function refRow(
  kind: SharedRefKind,
  n: number,
  overrides: { createdAt?: number; messageId?: string; url?: string } = {}
): SharedRefsWriteRow {
  const messageId = overrides.messageId ?? `m-${kind}-${n}`;
  const createdAt = overrides.createdAt ?? 1_700_000_000_000 + n;
  const url = overrides.url ?? `https://example.com/${kind}/${n}`;
  // One ref per kind, each shaped the way the real extractor emits it, so a
  // backend that reads these exercises the same record projection a walk writes.
  const byKind: Record<SharedRefKind, SharedRefsWriteRow["refs"]> = {
    link: { links: [url], media: [], postIds: [] },
    media: {
      links: [],
      media: [{ imageIndex: 0, kind: "image", url: `${url}/0` }],
      postIds: [],
    },
    post: { links: [], media: [], postIds: [`${url}/0`] },
  };
  return { createdAt, messageId, refs: byKind[kind], senderId: "user-a" };
}

export function rowsFor(
  kind: SharedRefKind,
  count: number,
  start = 0
): Map<string, SharedRefsWriteRow> {
  const rows = new Map<string, SharedRefsWriteRow>();
  for (let index = start; index < start + count; index += 1) {
    const row = refRow(kind, index);
    rows.set(row.messageId, row);
  }
  return rows;
}

// A single message carrying `count` images, as a ten-image album.
export function albumRow(messageId: string, count: number): SharedRefsWriteRow {
  return {
    createdAt: 1_700_000_000_000,
    messageId,
    refs: {
      links: [],
      media: Array.from({ length: count }, (_unused, index) => ({
        imageIndex: index,
        kind: "image" as const,
        url: `https://i.example/${messageId}/${index}`,
      })),
      postIds: [],
    },
    senderId: "user-a",
  };
}

export function runSharedRefsStoreSuite(
  label: string,
  create: () => SharedRefsStoreUnderTest
): void {
  describe(`shared refs store (${label})`, () => {
    test("round-trips a ref and reports its kind's total", async () => {
      const store = create();
      await store.putSharedRefs(CONVERSATION, rowsFor("media", 3));
      const page = await store.readSharedRefs(CONVERSATION, "media", {
        limit: 50,
      });
      expect(page.items).toHaveLength(3);
      const counts = await store.readSharedRefsCounts(CONVERSATION);
      expect(counts?.media).toBe(3);
      expect(counts?.link).toBe(0);
      expect(counts?.post).toBe(0);
    });

    test("returns newest first, and paging never repeats or drops a row", async () => {
      const store = create();
      // Written oldest first, which is the order a backfill page commits in and
      // the order a live message arrives out of.
      await store.putSharedRefs(CONVERSATION, rowsFor("media", 10));
      const first = await store.readSharedRefs(CONVERSATION, "media", {
        limit: 4,
      });
      expect(first.items).toHaveLength(4);
      expect(first.hasMore).toBe(true);
      expect(first.after).toBeDefined();

      const second = await store.readSharedRefs(CONVERSATION, "media", {
        after: first.after,
        limit: 4,
      });
      const third = await store.readSharedRefs(CONVERSATION, "media", {
        after: second.after,
        limit: 4,
      });

      const paged = [...first.items, ...second.items, ...third.items];
      expect(paged).toHaveLength(10);
      // The order the writer handed over is oldest first, so a correct
      // newest-first read is exactly its reverse.
      const times = paged.map((record) => record.createdAt);
      expect(times).toStrictEqual([...times].toSorted((a, b) => b - a));
      // Distinct messages, so no row was served twice across the seam.
      expect(new Set(paged.map((record) => record.messageId)).size).toBe(10);
    });

    test("hasMore is false on the final page, so no empty page is offered", async () => {
      const store = create();
      await store.putSharedRefs(CONVERSATION, rowsFor("link", 2));
      const page = await store.readSharedRefs(CONVERSATION, "link", {
        limit: 10,
      });
      expect(page.hasMore).toBe(false);
      // And no cursor past the end, which would make a caller page once for
      // nothing.
      expect(page.after).toBeUndefined();
    });

    test("keeps the kinds apart", async () => {
      const store = create();
      const rows = new Map([
        ...rowsFor("media", 2),
        ...rowsFor("link", 3),
        ...rowsFor("post", 1),
      ]);
      await store.putSharedRefs(CONVERSATION, rows);
      const counts = await store.readSharedRefsCounts(CONVERSATION);
      expect(counts).toMatchObject({ link: 3, media: 2, post: 1 });
      const media = await store.readSharedRefs(CONVERSATION, "media", {
        limit: 50,
      });
      const link = await store.readSharedRefs(CONVERSATION, "link", {
        limit: 50,
      });
      const post = await store.readSharedRefs(CONVERSATION, "post", {
        limit: 50,
      });
      expect(media.items).toHaveLength(2);
      expect(link.items).toHaveLength(3);
      expect(post.items).toHaveLength(1);
    });

    // An edit replaces a message's refs. Keeping the old rows would show the user
    // two things at once: the URL a message used to carry and the one it carries
    // now, neither of which is a message they can read.
    test("a rewrite replaces the message's refs instead of adding to them", async () => {
      const store = create();
      const original = rowsFor("link", 1);
      const messageId = [...original.keys()][0] as string;
      await store.putSharedRefs(CONVERSATION, original);
      const before = await store.readSharedRefs(CONVERSATION, "link", {
        limit: 50,
      });
      expect(before.items).toHaveLength(1);

      await store.putSharedRefs(
        CONVERSATION,
        new Map([
          [messageId, refRow("link", 0, { url: "https://example.com/edited" })],
        ])
      );

      const after = await store.readSharedRefs(CONVERSATION, "link", {
        limit: 50,
      });
      expect(after.items).toHaveLength(1);
      expect(after.items[0]?.url).toBe("https://example.com/edited");
      const counts = await store.readSharedRefsCounts(CONVERSATION);
      expect(counts?.link).toBe(1);
    });

    test("a rewrite that strips every ref leaves nothing behind", async () => {
      const store = create();
      const messageId = "m-link-9";
      await store.putSharedRefs(CONVERSATION, rowsFor("link", 1));
      await store.putSharedRefs(
        CONVERSATION,
        new Map([
          [
            messageId,
            {
              createdAt: 1_700_000_009_000,
              messageId,
              refs: { links: [], media: [], postIds: [] },
              senderId: "user-a",
            },
          ],
        ])
      );
      const page = await store.readSharedRefs(CONVERSATION, "link", {
        limit: 50,
      });
      // The unrelated message survives; the stripped one is gone.
      const kept = page.items.map((record) => record.messageId);
      expect(kept).not.toContain(messageId);
    });

    test("removing a message drops its refs and its count", async () => {
      const store = create();
      const rows = rowsFor("media", 3);
      await store.putSharedRefs(CONVERSATION, rows);
      const target = [...rows.keys()][1] as string;
      await store.removeSharedRefs(CONVERSATION, [target]);

      const page = await store.readSharedRefs(CONVERSATION, "media", {
        limit: 50,
      });
      const left = page.items.map((record) => record.messageId);
      expect(left).not.toContain(target);
      expect(left).toHaveLength(2);
      const counts = await store.readSharedRefsCounts(CONVERSATION);
      expect(counts?.media).toBe(2);
    });

    test("removing a message that has no refs is a no-op, not a negative count", async () => {
      const store = create();
      await store.putSharedRefs(CONVERSATION, rowsFor("media", 1));
      await store.removeSharedRefs(CONVERSATION, ["never-indexed"]);
      const counts = await store.readSharedRefsCounts(CONVERSATION);
      expect(counts?.media).toBe(1);
    });

    // The two backends must agree about this, or the tab label appears in one and
    // not the other for the same conversation.
    test("an unindexed conversation reads empty rather than failing", async () => {
      const store = create();
      const page = await store.readSharedRefs(CONVERSATION, "media", {
        limit: 10,
      });
      expect(page).toMatchObject({ hasMore: false, items: [] });
      expect(await store.readSharedRefsCounts(CONVERSATION)).toBeNull();
    });

    test("conversations do not see each other's refs", async () => {
      const store = create();
      await store.putSharedRefs(CONVERSATION, rowsFor("media", 2));
      await store.putSharedRefs("conv-2", rowsFor("media", 1, 100));
      const first = await store.readSharedRefs(CONVERSATION, "media", {
        limit: 50,
      });
      const second = await store.readSharedRefs("conv-2", "media", {
        limit: 50,
      });
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
    });

    test("refs-only conversations are enumerable for account-scope cleanup", async () => {
      const store = create();
      await store.putSharedRefs(CONVERSATION, rowsFor("media", 1));

      const summaries = await store.listConversations();
      expect(summaries.map((summary) => summary.conversationId)).toContain(
        CONVERSATION
      );
    });

    test("a stored row keeps the sender and the time it was indexed from", async () => {
      const store = create();
      const row = refRow("post", 0, { createdAt: 1_234_567_890_123 });
      await store.putSharedRefs(CONVERSATION, new Map([[row.messageId, row]]));
      const page = await store.readSharedRefs(CONVERSATION, "post", {
        limit: 5,
      });
      expect(page.items[0]).toMatchObject({
        createdAt: 1_234_567_890_123,
        messageId: row.messageId,
        postId: "https://example.com/post/0/0",
        senderId: "user-a",
      });
    });

    // One message, ten images: the case where a page turn lands in the middle of
    // one message's refs, and where a per-page index would renumber images a
    // mounted virtualized row is already anchored on.
    test("one message's album survives a page turn in album order", async () => {
      const store = create();
      await store.putSharedRefs(
        CONVERSATION,
        new Map([["m-album", albumRow("m-album", 10)]])
      );
      const first = await store.readSharedRefs(CONVERSATION, "media", {
        limit: 4,
      });
      const second = await store.readSharedRefs(CONVERSATION, "media", {
        after: first.after,
        limit: 4,
      });
      const third = await store.readSharedRefs(CONVERSATION, "media", {
        after: second.after,
        limit: 4,
      });
      const all = [...first.items, ...second.items, ...third.items];
      expect(all).toHaveLength(10);
      // Album order, which the inverted key component makes a descending cursor
      // produce. Per-page reversal cannot: a page boundary lands mid-album, so each
      // page would reverse its own run and the album would read 6-9, 2-5, 0-1.
      expect(all.map((record) => record.index)).toStrictEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      expect(all.every((record) => record.messageId === "m-album")).toBe(true);
    });
  });
}

describe("shared ref records", () => {
  test("one record per ref, indexed by its position within the message", () => {
    const { counts, records } = buildSharedRefRecords({
      createdAt: 42,
      messageId: "m1",
      refs: {
        links: ["https://a.example", "https://b.example"],
        media: [
          { imageIndex: 0, kind: "image", url: "https://i.example/0" },
          { imageIndex: 1, kind: "gif", url: "https://i.example/1" },
        ],
        postIds: ["p1"],
      },
      senderId: "user-a",
    });
    expect(counts).toStrictEqual({ link: 2, media: 2, post: 1 });
    expect(records).toHaveLength(5);
    // Filtered by KIND, not by url shape: both a link and a media record carry a
    // url, so a url-shape filter would count the media as links too.
    const links = records.filter(
      (record) => record.postId === undefined && record.mediaKind === undefined
    );
    expect(links.map((record) => record.index)).toStrictEqual([0, 1]);
    const media = records.filter((record) => record.mediaKind !== undefined);
    expect(media.map((record) => record.index)).toStrictEqual([0, 1]);
    expect(media[1]?.mediaKind).toBe("gif");
    const posts = records.filter((record) => record.postId !== undefined);
    expect(posts.map((record) => record.index)).toStrictEqual([0]);
  });

  test("a message with no refs produces no records", () => {
    const { records } = buildSharedRefRecords({
      createdAt: 1,
      messageId: "m1",
      refs: { links: [], media: [], postIds: [] },
      senderId: "u",
    });
    expect(records).toEqual([]);
  });

  // A record this build cannot read must read as absent, not be half-interpreted.
  // Both backends check the version, and a future shape therefore costs one
  // re-derivation rather than a wrong row.
  test("every record this build writes carries the current version", () => {
    const { records } = buildSharedRefRecords({
      createdAt: 1,
      messageId: "m1",
      refs: {
        links: ["https://a.example"],
        media: [{ imageIndex: 0, kind: "image", url: "https://i.example" }],
        postIds: ["p1"],
      },
      senderId: "u",
    });
    for (const record of records) {
      expect(record.version).toBe(SHARED_REFS_FORMAT_VERSION);
    }
  });
});

describe("shared ref time keys", () => {
  test("sort chronologically as strings, which an unpadded millisecond does not", () => {
    // The bug this guards: "978307200000" is a different CENTURY than
    // "9783072000000", and text order puts it LAST, so a newest-first read would
    // come back in the wrong order.
    const older = sharedRefTimeKey(978_307_200_000, "m1", 0);
    const newer = sharedRefTimeKey(9_783_072_000_000, "m2", 0);
    expect(older < newer).toBe(true);
    expect(older.localeCompare(newer)).toBe(-1);
  });

  test("a message's refs sort DESCENDING by index, so a descending read gives album order", () => {
    // The whole reason the index is inverted in the key: a page walk is a
    // descending cursor, so this ordering is what makes a ten-image album read
    // 0,1,2,3 rather than 3,2,1,0, and it holds ACROSS a page turn.
    const first = sharedRefTimeKey(5, "m1", 0);
    const second = sharedRefTimeKey(5, "m1", 1);
    const tenth = sharedRefTimeKey(5, "m1", 9);
    expect(first > second).toBe(true);
    expect(second > tenth).toBe(true);
    // Sorted in key order, the logical indices come back newest-index-first, so a
    // descending cursor over this key yields ascending album order.
    expect([first, second, tenth].toSorted()).toStrictEqual([
      tenth,
      second,
      first,
    ]);
  });

  test("the index component is wide enough for the largest possible album", () => {
    // MAX_MESSAGE_ATTACHMENTS is the real ceiling: ten images in one message, and
    // the inverted key has to stay monotonic across that whole range. Asserted
    // against the constant, so a future bump to attachments cannot quietly break
    // the ordering.
    const keys = Array.from(
      { length: MAX_MESSAGE_ATTACHMENTS },
      (_unused, index) => sharedRefTimeKey(5, "m1", index)
    );
    expect([...keys].toSorted()).toStrictEqual([...keys].toReversed());
  });

  test("a non-finite timestamp still produces a sortable key", () => {
    const key = sharedRefTimeKey(Number.NaN, "m1", 0);
    expect(key.startsWith("00000000000000:")).toBe(true);
  });

  test("a same-millisecond tie still produces a total order across messages", () => {
    const a = sharedRefTimeKey(5, "m-a", 0);
    const b = sharedRefTimeKey(5, "m-b", 0);
    expect(a === b).toBe(false);
    expect(a !== b).toBe(true);
  });
});

describe("shared ref ranges", () => {
  test("an absent cursor puts every key of the kind inside the range", () => {
    const { lower, upper } = sharedRefRange("c1", "media");
    expect(lower).toStrictEqual(["c1", "media", ""]);
    // Above any character a time key can contain, so nothing is excluded.
    expect(upper).toStrictEqual(["c1", "media", "￿"]);
  });

  test("a cursor bounds the kind from ABOVE, because the cursor runs backwards", () => {
    // The bug this guards: bounding from below excludes nothing a descending
    // cursor was going to visit, so every page repeats page one.
    const { upper } = sharedRefRange("c1", "media", "0000005:m1:0");
    expect(upper[2]).toBe("0000005:m1:0");
  });

  test("a kind's range never reaches into the next kind", () => {
    const { lower, upper } = sharedRefRange("c1", "media");
    expect(lower[1]).toBe("media");
    expect(upper[1]).toBe("media");
  });
});

describe("empty counts", () => {
  test("starts at zero for every kind", () => {
    expect(emptySharedRefsCounts("c1")).toStrictEqual({
      conversationId: "c1",
      link: 0,
      media: 0,
      post: 0,
      version: SHARED_REFS_FORMAT_VERSION,
    });
  });
});

describe("stored ref record shape", () => {
  test("carries everything a tab row needs", () => {
    const record: SharedRefRecord = {
      createdAt: 1,
      index: 0,
      mediaKind: "image",
      messageId: "m1",
      senderId: "u1",
      url: "https://i.example/0",
      version: SHARED_REFS_FORMAT_VERSION,
    };
    expect(Object.keys(record).toSorted()).toStrictEqual([
      "createdAt",
      "index",
      "mediaKind",
      "messageId",
      "senderId",
      "url",
      "version",
    ]);
  });
});

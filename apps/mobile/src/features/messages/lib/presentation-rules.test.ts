import { describe, expect, test } from "bun:test";

import {
  CONVERSATION_THEMES,
  DEFAULT_CONVERSATION_THEME_KEY,
  isConversationThemeKey,
  resolveConversationTheme,
  sentBubbleShadows,
} from "./conversation-theme";
import {
  albumHeightForWidth,
  albumTileFrames,
  ALBUM_LAYOUTS,
  getAlbumLayout,
  isWellFormedAlbumLayout,
} from "./message-album-layout";
import {
  BUBBLE_RADIUS,
  bubbleCorners,
  bubblePosition,
} from "./message-bubble-shape";
import {
  chunkMessageIds,
  MAX_HIDE_BATCH,
  messageDeleteCopy,
} from "./message-delete";
import {
  formatArrivalCount,
  formatClockTime,
  formatListTimestamp,
  formatReceiptStamp,
  formatTimeDivider,
  getMessageGroupMeta,
  GROUP_WINDOW_MS,
  TIME_DIVIDER_MS,
} from "./message-grouping";
import { conversationPreviewText, messagePreviewText } from "./message-preview";
import {
  advanceWatermark,
  EMPTY_WATERMARKS,
  getMessageReceipt,
  peerWatermarks,
  receiptLabel,
} from "./message-receipts";
// The presentation rules a transcript is built from: grouping, bubble shaping,
// dividers, receipts, the unread boundary, list previews, album geometry, delete
// copy and chat themes. All pure, so the rules are asserted without a renderer.
import { buildTranscriptRows } from "./transcript-rows";
import type { MessageData } from "./types";
import { firstUnreadMessageId, UNREAD_DIVIDER_LABEL } from "./unread-marker";

const NOW = new Date(2026, 5, 15, 14, 30, 0);

describe("message grouping", () => {
  const at = (minutesAgo: number, senderId = "alice") => ({
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    senderId,
  });

  test("a run from one sender groups, and the last row carries the avatar", () => {
    const messages = [at(3), at(2), at(1)];
    expect(getMessageGroupMeta(messages, 0)).toEqual({
      isFirstInGroup: true,
      isLastInGroup: false,
      showTimeDivider: true,
    });
    expect(getMessageGroupMeta(messages, 1)).toEqual({
      isFirstInGroup: false,
      isLastInGroup: false,
      showTimeDivider: false,
    });
    expect(getMessageGroupMeta(messages, 2)).toEqual({
      isFirstInGroup: false,
      isLastInGroup: true,
      showTimeDivider: false,
    });
  });

  test("a sender change breaks the group", () => {
    const messages = [at(2, "alice"), at(1, "bob")];
    expect(getMessageGroupMeta(messages, 0).isLastInGroup).toBe(true);
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(true);
  });

  test("a gap longer than the window breaks the group", () => {
    // Eight minutes apart: past GROUP_WINDOW_MS, so not one block.
    const messages = [at(10), at(2)];
    expect(getMessageGroupMeta(messages, 0).isLastInGroup).toBe(true);
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(true);
  });

  test("a message exactly at the window edge still groups", () => {
    const messages = [at(GROUP_WINDOW_MS / 60_000), at(0)];
    expect(getMessageGroupMeta(messages, 0).isLastInGroup).toBe(false);
  });

  test("clock skew does not produce a tight stack", () => {
    const messages = [at(1), at(5)];
    expect(getMessageGroupMeta(messages, 0).isLastInGroup).toBe(true);
  });

  test("a long pause gets a time divider, a fast exchange does not", () => {
    // Twenty minutes apart: past TIME_DIVIDER_MS, so it gets stamped.
    expect(getMessageGroupMeta([at(20), at(0)], 1).showTimeDivider).toBe(true);
    // Ten minutes apart: under it, so it does not.
    expect(getMessageGroupMeta([at(10), at(0)], 1).showTimeDivider).toBe(false);
    expect(TIME_DIVIDER_MS).toBe(15 * 60 * 1000);
  });

  test("an out-of-range index renders a self-contained row", () => {
    expect(getMessageGroupMeta([], 4)).toEqual({
      isFirstInGroup: true,
      isLastInGroup: true,
      showTimeDivider: false,
    });
  });

  test("an unparseable timestamp fails safe", () => {
    const messages = [
      { createdAt: "not-a-date", senderId: "alice" },
      { createdAt: new Date(NOW), senderId: "alice" },
    ];
    expect(getMessageGroupMeta(messages, 0).isLastInGroup).toBe(true);
    expect(getMessageGroupMeta(messages, 1).isFirstInGroup).toBe(true);
  });

  test("a divider label names the day", () => {
    expect(formatTimeDivider(new Date(2026, 5, 15, 9, 5), NOW)).toBe("9:05 AM");
    expect(formatTimeDivider(new Date(2026, 5, 14, 9, 5), NOW)).toBe(
      "Yesterday 9:05 AM"
    );
    expect(formatTimeDivider(new Date(2026, 5, 3, 9, 5), NOW)).toBe(
      "Jun 3, 9:05 AM"
    );
    expect(formatTimeDivider(new Date(2025, 11, 3, 9, 5), NOW)).toBe(
      "Dec 3, 2025, 9:05 AM"
    );
    expect(formatTimeDivider("nonsense", NOW)).toBeNull();
  });

  test("midnight reads as 12 AM, not 0 AM", () => {
    expect(formatClockTime(new Date(2026, 5, 15, 0, 0))).toBe("12:00 AM");
    expect(formatClockTime(new Date(2026, 5, 15, 12, 0))).toBe("12:00 PM");
    expect(formatClockTime(new Date(2026, 5, 15, 23, 7))).toBe("11:07 PM");
  });

  test("a list stamp collapses to time today and Yesterday next day", () => {
    expect(formatListTimestamp(new Date(2026, 5, 15, 9, 5), NOW)).toBe(
      "9:05 AM"
    );
    expect(formatListTimestamp(new Date(2026, 5, 14, 9, 5), NOW)).toBe(
      "Yesterday"
    );
    expect(formatListTimestamp(new Date(2026, 5, 3, 9, 5), NOW)).toBe("Jun 3");
    expect(formatListTimestamp(new Date(2025, 11, 3, 9, 5), NOW)).toBe(
      "Dec 3, 2025"
    );
    expect(formatListTimestamp(null, NOW)).toBe("");
  });

  test("a receipt stamp renders, and nothing renders for no stamp", () => {
    // NOW is 14:30 local, so a minute earlier is 2:29 PM on a 12-hour clock.
    expect(formatReceiptStamp(NOW.getTime() - 60_000, NOW)).toBe("2:29 PM");
    expect(formatReceiptStamp(null, NOW)).toBe("");
  });

  test("a badge caps at 99+", () => {
    expect(formatArrivalCount(0)).toBe("");
    expect(formatArrivalCount(1)).toBe("1");
    expect(formatArrivalCount(99)).toBe("99");
    expect(formatArrivalCount(100)).toBe("99+");
    expect(formatArrivalCount(5000)).toBe("99+");
  });
});

describe("bubble shaping", () => {
  test("a lone message is fully rounded apart from its tail", () => {
    expect(bubblePosition(true, true)).toBe("solo");
    const mine = bubbleCorners("solo", true);
    expect(mine.borderTopRightRadius).toBe(BUBBLE_RADIUS);
    expect(mine.borderBottomRightRadius).toBe(4);
    const theirs = bubbleCorners("solo", false);
    expect(theirs.borderTopLeftRadius).toBe(BUBBLE_RADIUS);
    expect(theirs.borderBottomLeftRadius).toBe(4);
  });

  test("only the thread edge is ever shaped", () => {
    for (const position of ["solo", "top", "middle", "bottom"] as const) {
      const mine = bubbleCorners(position, true);
      // The left edge always faces away from an own (right-aligned) message.
      expect(mine.borderTopLeftRadius).toBe(BUBBLE_RADIUS);
      expect(mine.borderBottomLeftRadius).toBe(BUBBLE_RADIUS);
      const theirs = bubbleCorners(position, false);
      expect(theirs.borderTopRightRadius).toBe(BUBBLE_RADIUS);
      expect(theirs.borderBottomRightRadius).toBe(BUBBLE_RADIUS);
    }
  });

  test("a middle message tightens both corners of its edge", () => {
    const mine = bubbleCorners("middle", true);
    expect(mine.borderTopRightRadius).toBe(6);
    expect(mine.borderBottomRightRadius).toBe(6);
    const theirs = bubbleCorners("middle", false);
    expect(theirs.borderTopLeftRadius).toBe(6);
    expect(theirs.borderBottomLeftRadius).toBe(6);
  });

  test("the first message tightens only its bottom corner", () => {
    expect(bubbleCorners("top", true).borderBottomRightRadius).toBe(6);
    expect(bubbleCorners("top", true).borderTopRightRadius).toBe(BUBBLE_RADIUS);
  });

  test("the last message tightens its top corner and keeps the tail", () => {
    const last = bubbleCorners("bottom", true);
    expect(last.borderTopRightRadius).toBe(6);
    expect(last.borderBottomRightRadius).toBe(4);
  });
});

describe("album geometry", () => {
  test("every shipped layout is a hole-free rectangle partition", () => {
    for (const [count, rows] of Object.entries(ALBUM_LAYOUTS)) {
      expect(isWellFormedAlbumLayout(rows, Number(count))).toBe(true);
    }
  });

  test("the layout count matches the image count", () => {
    for (const [count, _rows] of Object.entries(ALBUM_LAYOUTS)) {
      expect(getAlbumLayout(Number(count)).placements).toHaveLength(
        Number(count)
      );
    }
  });

  test("the first image is the hero and lands top-left", () => {
    const layout = getAlbumLayout(5);
    expect(layout.placements[0]).toMatchObject({ col: 0, row: 0 });
  });

  test("a single tile is a plain 1x1", () => {
    expect(getAlbumLayout(1)).toMatchObject({ cols: 1, rows: 1 });
  });

  test("an unknown count falls back to a uniform grid", () => {
    const layout = getAlbumLayout(12);
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(4);
    expect(layout.placements).toHaveLength(12);
  });

  test("a malformed map is rejected rather than silently drawn", () => {
    expect(isWellFormedAlbumLayout(["A B"], 2)).toBe(false);
    expect(isWellFormedAlbumLayout(["AA", "A"], 2)).toBe(false);
    expect(isWellFormedAlbumLayout(["AA", "AA"], 3)).toBe(false);
  });

  test("tiles tile the container with no gaps and no overlap", () => {
    const layout = getAlbumLayout(5);
    const size = { height: albumHeightForWidth(layout, 300), width: 300 };
    const frames = albumTileFrames(layout, size);
    expect(frames).toHaveLength(5);
    const covered = new Set<string>();
    for (const frame of frames) {
      covered.add(`${frame.x},${frame.y},${frame.width},${frame.height}`);
    }
    expect(covered.size).toBe(5);
    // Every frame sits inside the album box.
    for (const frame of frames) {
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(size.width + 0.001);
      expect(frame.y + frame.height).toBeLessThanOrEqual(size.height + 0.001);
    }
    // The 5-image layout is a 3x3 grid whose hero spans 2x2 cells, so it takes
    // two thirds of both dimensions. That asymmetry is what reads as a bento
    // rather than a contact sheet.
    expect(layout).toMatchObject({ cols: 3, rows: 3 });
    expect(frames[0]?.width).toBeCloseTo((size.width * 2) / 3);
    expect(frames[0]?.height).toBeCloseTo((size.height * 2) / 3);
  });
});

describe("receipts", () => {
  const created = new Date(2026, 5, 15, 12, 0);

  test("a received message carries no receipt", () => {
    expect(
      getMessageReceipt({
        createdAt: created,
        mine: false,
        watermarks: { deliveredAt: created.getTime() + 1000, readAt: null },
      })
    ).toBeNull();
  });

  test("reports only sent before any ack", () => {
    expect(
      getMessageReceipt({
        createdAt: created,
        mine: true,
        watermarks: EMPTY_WATERMARKS,
      })
    ).toEqual({ at: null, status: "sent" });
  });

  test("delivered, then read", () => {
    expect(
      getMessageReceipt({
        createdAt: created,
        mine: true,
        watermarks: { deliveredAt: created.getTime() + 1000, readAt: null },
      })?.status
    ).toBe("delivered");
    expect(
      getMessageReceipt({
        createdAt: created,
        mine: true,
        watermarks: {
          deliveredAt: created.getTime() + 1000,
          readAt: created.getTime() + 2000,
        },
      })?.status
    ).toBe("read");
  });

  test("a message newer than both watermarks is only sent", () => {
    expect(
      getMessageReceipt({
        createdAt: created,
        mine: true,
        watermarks: {
          deliveredAt: created.getTime() - 1000,
          readAt: created.getTime() - 500,
        },
      })?.status
    ).toBe("sent");
  });

  test("a message AT the watermark counts as acked", () => {
    expect(
      getMessageReceipt({
        createdAt: created,
        mine: true,
        watermarks: {
          deliveredAt: created.getTime(),
          readAt: null,
        },
      })?.status
    ).toBe("delivered");
  });

  test("an unparseable timestamp degrades to sent, never a fake ack", () => {
    expect(
      getMessageReceipt({
        createdAt: "nonsense",
        mine: true,
        watermarks: { deliveredAt: Date.now(), readAt: Date.now() },
      })
    ).toEqual({ at: null, status: "sent" });
  });

  test("a watermark never moves backwards", () => {
    expect(advanceWatermark(100, 50)).toBe(100);
    expect(advanceWatermark(100, 150)).toBe(150);
    expect(advanceWatermark(null, 150)).toBe(150);
    expect(advanceWatermark(100, null)).toBe(100);
    expect(advanceWatermark(null, null)).toBeNull();
  });

  test("reads the peer's watermarks, not my own", () => {
    expect(
      peerWatermarks(
        [
          {
            lastDeliveredAt: "2026-05-15T12:00:00Z",
            lastReadAt: null,
            userId: "me",
          },
          {
            lastDeliveredAt: "2026-05-15T13:00:00Z",
            lastReadAt: "2026-05-15T13:30:00Z",
            userId: "peer",
          },
        ],
        "me"
      )
    ).toEqual({
      deliveredAt: new Date("2026-05-15T13:00:00Z").getTime(),
      readAt: new Date("2026-05-15T13:30:00Z").getTime(),
    });
  });

  test("no peer, no me, or no members all report sent-only", () => {
    expect(peerWatermarks([], "me")).toEqual(EMPTY_WATERMARKS);
    expect(
      peerWatermarks(
        [{ lastDeliveredAt: null, lastReadAt: null, userId: "me" }],
        "me"
      )
    ).toEqual(EMPTY_WATERMARKS);
    expect(peerWatermarks(undefined, "me")).toEqual(EMPTY_WATERMARKS);
    // Members that contain only me: no peer to read a watermark from.
    expect(
      peerWatermarks(
        [{ lastDeliveredAt: null, lastReadAt: null, userId: "me" }],
        "me"
      )
    ).toEqual(EMPTY_WATERMARKS);
  });

  test("labels match the status", () => {
    expect(receiptLabel("sent")).toBe("Sent");
    expect(receiptLabel("delivered")).toBe("Delivered");
    expect(receiptLabel("read")).toBe("Read");
  });
});

describe("unread boundary", () => {
  const messages = [
    { createdAt: "2026-05-15T10:00:00Z", id: "m1", senderId: "peer" },
    { createdAt: "2026-05-15T11:00:00Z", id: "m2", senderId: "me" },
    { createdAt: "2026-05-15T12:00:00Z", id: "m3", senderId: "peer" },
    { createdAt: "2026-05-15T13:00:00Z", id: "m4", senderId: "peer" },
  ];

  test("anchors on the oldest peer message after the read watermark", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: "2026-05-15T11:00:00Z",
        messages,
        myUserId: "me",
      })
    ).toBe("m3");
  });

  test("a null watermark anchors on the first peer message", () => {
    expect(
      firstUnreadMessageId({ lastReadAt: null, messages, myUserId: "me" })
    ).toBe("m1");
  });

  test("own messages never count", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: null,
        messages: [
          { createdAt: "2026-05-15T10:00:00Z", id: "m2", senderId: "me" },
        ],
        myUserId: "me",
      })
    ).toBeNull();
  });

  test("a deleted row is skipped, so the divider is never above nothing", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: null,
        messages: [
          {
            createdAt: "2026-05-15T10:00:00Z",
            deletedAt: "2026-05-15T10:00:01Z",
            id: "m1",
            senderId: "peer",
          },
          { createdAt: "2026-05-15T11:00:00Z", id: "m3", senderId: "peer" },
        ],
        myUserId: "me",
      })
    ).toBe("m3");
  });

  test("a message AT the watermark is already read", () => {
    const [first] = messages;
    if (!first) {
      throw new Error("the fixture should have a first message");
    }
    expect(
      firstUnreadMessageId({
        lastReadAt: "2026-05-15T10:00:00Z",
        messages: [first],
        myUserId: "me",
      })
    ).toBeNull();
  });

  test("everything read means no divider", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: "2026-05-15T14:00:00Z",
        messages,
        myUserId: "me",
      })
    ).toBeNull();
  });

  test("the label ships with the rule", () => {
    expect(UNREAD_DIVIDER_LABEL).toBe("New messages");
  });
});

describe("conversation previews", () => {
  test("a caption is the preview, not 'Shared an image'", () => {
    expect(
      messagePreviewText({
        content: "at the beach",
        images: [{ url: "/api/media/a" }],
        kind: "image",
        type: "media",
      })
    ).toBe("at the beach");
  });

  test("newlines collapse so a preview stays one line", () => {
    expect(messagePreviewText({ content: "a\n\n  b\tc  ", type: "text" })).toBe(
      "a b c"
    );
  });

  test("an uncaptioned payload says what it is", () => {
    expect(messagePreviewText({ postId: "p1", type: "post" })).toBe(
      "Shared a post"
    );
    expect(
      messagePreviewText({
        images: [{ url: "/api/media/a" }],
        kind: "image",
        type: "media",
      })
    ).toBe("Shared an image");
    expect(
      messagePreviewText({
        images: [{ url: "/api/media/a" }, { url: "/api/media/b" }],
        kind: "image",
        type: "media",
      })
    ).toBe("Shared 2 images");
    expect(
      messagePreviewText({ kind: "gif", type: "media", url: "/api/media/a" })
    ).toBe("Shared a GIF");
  });

  test("an unknown payload invents no description", () => {
    expect(messagePreviewText({ type: "text" } as never)).toBe("");
  });

  test("own messages are framed with the sender", () => {
    expect(
      conversationPreviewText({
        deleted: false,
        mine: true,
        payload: { content: "hi", type: "text" },
      })
    ).toBe("You: hi");
    expect(
      conversationPreviewText({
        deleted: false,
        mine: false,
        payload: { content: "hi", type: "text" },
      })
    ).toBe("hi");
  });

  test("a deleted message says so and does not say who deleted it", () => {
    expect(
      conversationPreviewText({
        deleted: true,
        mine: true,
        payload: { content: "hi", type: "text" },
      })
    ).toBe("This message was deleted");
  });

  test("an undecryptable message reads as blank, not as an empty chat", () => {
    expect(
      conversationPreviewText({
        deleted: false,
        mine: false,
        payload: undefined,
      })
    ).toBe("");
  });
});

describe("delete copy", () => {
  test("delete-for-everyone is always singular", () => {
    expect(messageDeleteCopy({ count: 7, scope: "for-everyone" })).toEqual({
      confirmLabel: "Delete for everyone",
      description:
        "This message will be removed for both of you. This can't be undone.",
      title: "Delete for everyone?",
    });
  });

  test("delete-for-me counts the selection", () => {
    expect(messageDeleteCopy({ count: 1, scope: "for-me" }).title).toBe(
      "Delete for me?"
    );
    expect(messageDeleteCopy({ count: 4, scope: "for-me" }).title).toBe(
      "Delete 4 messages for me?"
    );
  });

  test("delete-for-me never claims to remove the peer's copy", () => {
    const copy = messageDeleteCopy({ count: 1, scope: "for-me" });
    expect(copy.description).toContain("other person will still see it");
  });

  test("a large selection is chunked rather than sent oversized", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `m${index}`);
    const chunks = chunkMessageIds(ids);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(MAX_HIDE_BATCH);
    expect(chunks[2]).toHaveLength(50);
    expect(chunks.flat()).toEqual(ids);
  });

  test("an empty selection is no chunks", () => {
    expect(chunkMessageIds([])).toEqual([]);
  });

  test("a non-positive chunk size is a programming error", () => {
    expect(() => chunkMessageIds(["a"], 0)).toThrow();
  });
});

// Relative luminance, for asserting a gradient stop is the lighter one.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16)
  );
  const [r = 0, g = 0, b = 0] = channels.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("chat themes", () => {
  test("an unknown key falls back to the default rather than leaving the chat bare", () => {
    expect(resolveConversationTheme("nope").key).toBe(
      DEFAULT_CONVERSATION_THEME_KEY
    );
    expect(resolveConversationTheme(null).key).toBe(
      DEFAULT_CONVERSATION_THEME_KEY
    );
    // A key this build does not know renders as the default rather than leaving
    // the chat unthemed.
    expect(resolveConversationTheme("from-a-newer-client").key).toBe(
      DEFAULT_CONVERSATION_THEME_KEY
    );
  });

  test("a known key resolves to its own theme", () => {
    for (const theme of CONVERSATION_THEMES) {
      expect(resolveConversationTheme(theme.key)).toEqual(theme);
      expect(isConversationThemeKey(theme.key)).toBe(true);
    }
  });

  test("every theme is a light stop over a dark stop, with a real ring", () => {
    // The gradient keeps the same top-lit direction in all of them, so the 3D
    // inner lip still reads as light catching an edge. Assert the ordering by
    // luminance rather than trusting the hex casing.
    for (const theme of CONVERSATION_THEMES) {
      expect(theme.from).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.to).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.ring).toMatch(/^rgba\(/);
      // The "from" stop must be the lighter of the pair.
      expect(luminance(theme.from)).toBeGreaterThan(luminance(theme.to));
    }
  });

  test("the app's own orange leads the picker", () => {
    expect(CONVERSATION_THEMES[0]?.key).toBe(DEFAULT_CONVERSATION_THEME_KEY);
    expect(CONVERSATION_THEMES[0]?.from).toBe("#ff9500");
  });

  test("theme keys are unique", () => {
    const keys = CONVERSATION_THEMES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a non-string key is not a theme", () => {
    expect(isConversationThemeKey(42)).toBe(false);
    expect(isConversationThemeKey(null)).toBe(false);
  });

  test("the bubble shadow carries the theme's own ring", () => {
    const theme = resolveConversationTheme("ocean");
    expect(sentBubbleShadows(theme)).toContain(theme.ring);
    expect(sentBubbleShadows(theme)).toContain("inset 0 0 0 1px");
  });
});

test("inverted transcript dividers stay above their messages and do not stamp the newest row twice", () => {
  const messages = [
    makeMessage("first", "2026-10-09T10:00:00Z"),
    makeMessage("second", "2026-10-09T10:01:00Z"),
    makeMessage("later", "2026-10-09T11:00:00Z"),
  ];
  const rows = buildTranscriptRows(messages, "second");
  expect(rows.map((row) => row.key)).toEqual([
    "later",
    "divider-later",
    "second",
    "unread-second",
    "first",
    "divider-first",
  ]);
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
});

const makeMessage = (id: string, createdAt: string): MessageData => ({
  ciphertext: "opaque",
  conversationId: "thread",
  createdAt,
  deletedAt: null,
  editedAt: null,
  id,
  iv: "opaque",
  ratchetIndex: 0,
  senderId: "peer",
});

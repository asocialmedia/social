import { describe, expect, test } from "bun:test";

import {
  CONVERSATION_MEDIA_VIEWER_WINDOW_LIMIT,
  buildViewerMediaItems,
  mediaFlatKey,
  mergeConversationMediaPage,
  messageIdFromFlatKey,
  viewerAnchorIndex,
} from "./conversation-media";
import type { DecryptEntry } from "./decryptor";

function item(flatKey: string, createdAt: number) {
  return { createdAt, flatKey };
}

describe("mediaFlatKey", () => {
  test("keys pair a message with its photo ordinal", () => {
    expect(mediaFlatKey("m1", 0)).toBe("m1:0");
    expect(messageIdFromFlatKey("m1:2")).toBe("m1");
    expect(messageIdFromFlatKey("no-separator")).toBe("no-separator");
  });
});

describe("mergeConversationMediaPage", () => {
  test("dedupes by flatKey and time-sorts", () => {
    const merged = mergeConversationMediaPage(
      [item("m1:0", 1)],
      [item("m2:0", 2), item("m1:0", 1)],
      "initial",
      "m2:0"
    );
    expect(merged.map((i) => i.flatKey)).toEqual(["m1:0", "m2:0"]);
  });

  test("paging older keeps the head and paging newer keeps the tail", () => {
    const rows = Array.from({ length: 8 }, (_, i) => item(`m${i}:0`, i));
    expect(
      mergeConversationMediaPage(
        rows.slice(4),
        rows.slice(0, 4),
        "older",
        undefined,
        6
      ).map((i) => i.flatKey)
    ).toEqual(["m0:0", "m1:0", "m2:0", "m3:0", "m4:0", "m5:0"]);
    expect(
      mergeConversationMediaPage(
        rows.slice(4),
        rows.slice(0, 4),
        "newer",
        undefined,
        6
      ).map((i) => i.flatKey)
    ).toEqual(["m2:0", "m3:0", "m4:0", "m5:0", "m6:0", "m7:0"]);
  });

  test("an initial read centers on the anchor", () => {
    const rows = Array.from({ length: 10 }, (_, i) => item(`m${i}:0`, i));
    const merged = mergeConversationMediaPage([], rows, "initial", "m5:0", 5);
    expect(merged.map((i) => i.flatKey)).toEqual([
      "m3:0",
      "m4:0",
      "m5:0",
      "m6:0",
      "m7:0",
    ]);
  });

  test("an unknown anchor falls back to the tail", () => {
    const rows = Array.from({ length: 10 }, (_, i) => item(`m${i}:0`, i));
    const merged = mergeConversationMediaPage([], rows, "initial", "gone:0", 4);
    expect(merged.map((i) => i.flatKey)).toEqual([
      "m6:0",
      "m7:0",
      "m8:0",
      "m9:0",
    ]);
  });

  test("the window cap matches web", () => {
    expect(CONVERSATION_MEDIA_VIEWER_WINDOW_LIMIT).toBe(100);
  });
});

type ViewerMessage = Parameters<typeof buildViewerMediaItems>[0][number];

function viewerMessage(id: string, createdAt: string): ViewerMessage {
  return { createdAt, deletedAt: null, id } as ViewerMessage;
}

describe("buildViewerMediaItems", () => {
  test("flattens decrypted photo payloads in chrono order with photo ordinals", () => {
    const entries = new Map<string, DecryptEntry>([
      [
        "m2",
        {
          attachments: [
            { kind: "image", url: "/api/media/a" },
            { kind: "video", url: "/api/media/v" },
            { kind: "gif", url: "/api/media/g" },
          ],
          type: "media",
        },
      ],
      [
        "m1",
        {
          attachments: [{ kind: "image", url: "/api/media/b" }],
          type: "media",
        },
      ],
    ]);
    const items = buildViewerMediaItems(
      [
        viewerMessage("m2", "2026-01-02T00:00:00Z"),
        viewerMessage("m1", "2026-01-01T00:00:00Z"),
      ],
      (id) => entries.get(id),
      "https://api.example"
    );
    expect(items.map((i) => i.flatKey)).toEqual(["m1:0", "m2:0", "m2:1"]);
    expect(items[0]?.url).toBe("https://api.example/api/media/b");
    // The video is skipped, so the gif keeps the photo ordinal.
    expect(items[2]?.url).toBe("https://api.example/api/media/g");
  });

  test("skips deleted rows and undecrypted entries", () => {
    const items = buildViewerMediaItems(
      [
        {
          ...viewerMessage("m1", "2026-01-01T00:00:00Z"),
          deletedAt: "2026-01-02T00:00:00Z",
        },
        viewerMessage("m2", "2026-01-02T00:00:00Z"),
      ],
      (id) => (id === "m2" ? "pending" : undefined),
      "https://api.example"
    );
    expect(items).toEqual([]);
  });

  test("viewerAnchorIndex finds the tapped tile and falls back to the tail", () => {
    const entries = new Map<string, DecryptEntry>([
      [
        "m1",
        { attachments: [{ kind: "image", url: "https://x/1" }], type: "media" },
      ],
    ]);
    const items = buildViewerMediaItems(
      [viewerMessage("m1", "2026-01-01T00:00:00Z")],
      (id) => entries.get(id),
      "https://api.example"
    );
    expect(viewerAnchorIndex(items, "m1", 0)).toBe(0);
    expect(viewerAnchorIndex(items, "gone", 0)).toBe(0);
    expect(viewerAnchorIndex([], "m1", 0)).toBe(0);
  });
});

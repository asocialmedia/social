import { describe, expect, test } from "bun:test";

import type { FeedPost } from "@/features/feed/lib/feed-types";

import type { ProfileFeedItem } from "./profile-feed-rows";
import { chunkFeedRows, feedItemKey, shouldPinTabs } from "./profile-feed-rows";
import type { ProfileMedia } from "./profile-view-model";

// Only the id matters to the chunker, so the fixtures carry just that field.
function post(id: string): ProfileFeedItem {
  return { kind: "post", value: { id } as FeedPost };
}

function media(id: string): ProfileFeedItem {
  return { kind: "media", value: { id } as ProfileMedia };
}

function items(count: number): ProfileFeedItem[] {
  return Array.from({ length: count }, (_, index) => post(`p${index}`));
}

describe("feedItemKey", () => {
  test("scopes the key by kind so a post and its media never collide", () => {
    expect(feedItemKey(post("abc"))).toBe("post:abc");
    expect(feedItemKey(media("abc"))).toBe("media:abc");
  });
});

describe("chunkFeedRows", () => {
  test("keeps single-column tabs one item per row", () => {
    const rows = chunkFeedRows(items(3), false);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.cells).toHaveLength(1);
    }
  });

  test("pairs grid items into two-cell rows", () => {
    const rows = chunkFeedRows(items(4), true);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.cells).toHaveLength(2);
    expect(rows[1]?.cells).toHaveLength(2);
  });

  test("gives an odd trailing item a one-cell row so the grid width holds", () => {
    // A full-width last tile would break the two-up grid on the final row.
    const rows = chunkFeedRows(items(5), true);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.cells).toHaveLength(2);
    expect(rows[1]?.cells).toHaveLength(2);
    expect(rows[2]?.cells).toHaveLength(1);
  });

  test("handles empty and single-item input without emitting an empty row", () => {
    expect(chunkFeedRows([], true)).toEqual([]);
    expect(chunkFeedRows([], false)).toEqual([]);
    const single = chunkFeedRows(items(1), true);
    expect(single).toHaveLength(1);
    expect(single[0]?.cells).toHaveLength(1);
  });

  test("derives a two-cell key from both cells so rows re-key independently", () => {
    const rows = chunkFeedRows([post("a"), post("b")], true);
    // The key is what keeps the row identity stable across a tab switch, and it
    // has to change when either cell changes.
    expect(rows[0]?.key).toBe("post:a|post:b");
    expect(chunkFeedRows([post("a"), post("c")], true)[0]?.key).not.toBe(
      rows[0]?.key
    );
  });

  test("preserves order and loses no item across the pairing", () => {
    const source = items(7);
    const rows = chunkFeedRows(source, true);
    const flattened = rows.flatMap((row) => row.cells);
    expect(flattened).toEqual(source);
  });
});

describe("shouldPinTabs", () => {
  // A profile whose header pushes the strip down to 200px past the list top.
  const resting = 200;

  test("stays unpinned while the strip is still on screen", () => {
    expect(shouldPinTabs(0, resting)).toBe(false);
    expect(shouldPinTabs(100, resting)).toBe(false);
    expect(shouldPinTabs(resting - 2, resting)).toBe(false);
  });

  test("pins once the strip's top edge reaches the list top", () => {
    expect(shouldPinTabs(resting, resting)).toBe(true);
    expect(shouldPinTabs(resting + 1, resting)).toBe(true);
    expect(shouldPinTabs(4000, resting)).toBe(true);
  });

  test("tolerates the boundary so a slow drag cannot make it flap", () => {
    // Just under the resting offset: a 1px tolerance has to catch this, or the
    // strip flickers on and off while the offset parks on the boundary.
    expect(shouldPinTabs(resting - 1, resting)).toBe(true);
  });

  test("never pins before the strip has been measured", () => {
    // null is the pre-layout-pass state. Pinning here would show a bar whose
    // threshold is still unknown, overlapping the in-flow strip.
    expect(shouldPinTabs(0, null)).toBe(false);
    expect(shouldPinTabs(9999, null)).toBe(false);
  });

  test("handles a strip that rests at the very top", () => {
    // A header-less profile would rest at 0, and a 0 offset must still pin.
    expect(shouldPinTabs(0, 0)).toBe(true);
    expect(shouldPinTabs(1, 0)).toBe(true);
  });

  test("holds off until the strip reaches the pinned bar's own height", () => {
    // The pinned copy is drawn at topOffset, below the fixed back button. The
    // in-flow strip's screen position is restingY - contentOffsetY, so it
    // arrives at the pinned bar's height once contentOffsetY reaches
    // restingY - topOffset. Pinning earlier than that would show both strips at
    // once; pinning later would leave a gap where neither is visible.
    const topOffset = 50;
    expect(shouldPinTabs(resting - topOffset - 2, resting, topOffset)).toBe(
      false
    );
    expect(shouldPinTabs(resting - topOffset, resting, topOffset)).toBe(true);
    // Scrolled past the handover point, well above the pinned position: still
    // pinned, and the in-flow strip is now off the top of the list entirely.
    expect(shouldPinTabs(resting, resting, topOffset)).toBe(true);
  });

  test("ignores the offset before the strip has been measured", () => {
    // An unknown resting offset must not pin no matter how far it has scrolled.
    expect(shouldPinTabs(9999, null, 50)).toBe(false);
  });
});

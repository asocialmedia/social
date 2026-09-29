import type { FeedPost } from "@/features/feed/lib/feed-types";

import type { ProfileMedia, ProfileReply } from "./profile-view-model";

export type ProfileFeedItem =
  | { kind: "post"; value: FeedPost }
  | { kind: "media"; value: ProfileMedia }
  | { kind: "reply"; value: ProfileReply };

// Grid tabs are chunked into rows of two instead of using FlatList's numColumns.
// Changing numColumns on a live list is what forced the keyed remount that used
// to rebuild the profile header on every tab switch: RN caches cell layout per
// column count, so the list was thrown away rather than re-laid out. Chunking
// keeps one list instance for the whole screen, so the header (the list's
// ListHeaderComponent) is created once and stays put, and only the rows below it
// are swapped.
//
// `grid` is stamped on the row rather than inferred from the cell count, because
// "one cell" means two completely different things: a whole row on a
// single-column tab, and the trailing remainder of a two-up grid. Only the second
// one must be wrapped in the row container, and getting that backwards is what
// let a grid's last tile stretch across the full list width.
export type ProfileFeedRow =
  | { cells: [ProfileFeedItem]; grid: false; key: string }
  | { cells: [ProfileFeedItem]; grid: true; key: string }
  | { cells: [ProfileFeedItem, ProfileFeedItem]; grid: true; key: string };

// Both grid tabs are two-up, matching web's media-gallery and gusts grid.
export const GRID_TAB_COLUMNS = 2;

// The kind is part of the key so a post and the media it owns can never collide
// across a tab switch, and a two-cell row's key is derived from both cells so
// inserting a tile re-keys only the rows that actually changed.
export function feedItemKey(item: ProfileFeedItem): string {
  return `${item.kind}:${item.value.id}`;
}

// Single-column tabs pass straight through; grid tabs are paired up. An odd
// trailing item still gets a one-cell GRID row so the tile keeps its column
// width instead of stretching across the full row.
export function chunkFeedRows(
  items: ProfileFeedItem[],
  twoColumns: boolean
): ProfileFeedRow[] {
  if (!twoColumns) {
    return items.map((item) => ({
      cells: [item],
      grid: false,
      key: feedItemKey(item),
    }));
  }
  const rows: ProfileFeedRow[] = [];
  for (let index = 0; index < items.length; index += GRID_TAB_COLUMNS) {
    const first = items[index];
    const second = items[index + 1];
    if (first && second) {
      rows.push({
        cells: [first, second],
        grid: true,
        key: `${feedItemKey(first)}|${feedItemKey(second)}`,
      });
      continue;
    }
    if (first) {
      rows.push({ cells: [first], grid: true, key: feedItemKey(first) });
    }
  }
  return rows;
}

// The tab strip sits in the profile header, which is the list's
// ListHeaderComponent, so it scrolls away with the banner. This decides when the
// pinned copy takes over: the moment the in-flow strip's top edge reaches the
// height the pinned copy is pinned at.
//
// topOffset is that height. The pinned copy sits below the fixed back/settings
// bar (see the stickyTabs style), not at 0, so the handover has to happen where
// the in-flow strip actually lands rather than at the list's own top. The
// strip's screen position is tabsRestingY - contentOffsetY, so it reaches
// topOffset at contentOffsetY === tabsRestingY - topOffset.
//
// A null resting offset means the strip has not been measured yet, which is the
// case before the first layout pass, so nothing pins. The 1px tolerance keeps
// the strip from flapping on and off while a slow drag parks the offset exactly
// on the boundary.
const PIN_TOLERANCE_PX = 1;

export function shouldPinTabs(
  contentOffsetY: number,
  tabsRestingY: number | null,
  topOffset = 0
): boolean {
  if (tabsRestingY === null) {
    return false;
  }
  return contentOffsetY >= tabsRestingY - topOffset - PIN_TOLERANCE_PX;
}

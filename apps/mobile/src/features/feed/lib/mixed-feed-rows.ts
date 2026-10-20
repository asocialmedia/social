import type { ExternalPost } from "@asm/protocols/contracts";
import { mixFeedItems } from "@asm/protocols/discovery";
import type { FeedSource, MixedFeedItem } from "@asm/protocols/discovery";

import type { FeedRow } from "./feed-rows";

export type TimelineRow = MixedFeedItem<FeedRow>;

export function nativePostForRow(row: TimelineRow | undefined) {
  return row?.kind === "asm" ? row.value.post : undefined;
}

export function mixedFeedRows(
  native: FeedRow[],
  external: ExternalPost[],
  source: FeedSource,
  latest: boolean
): TimelineRow[] {
  const groups: FeedRow[][] = [];
  let current: FeedRow[] = [];
  for (const row of native) {
    current.push(row);
    if (!row.hasThreadChild) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  const mixed = mixFeedItems(groups, external, {
    createdAt: (group) => {
      let newest = "";
      for (const row of group) {
        if (row.post.createdAt > newest) {
          newest = row.post.createdAt;
        }
      }
      return newest;
    },
    id: (group) => group[0]?.post.id ?? "",
    latest,
    source,
  });
  const result: TimelineRow[] = [];
  for (const row of mixed) {
    if (row.kind === "bluesky") {
      result.push(row);
    } else {
      for (const value of row.value) {
        result.push({
          createdAt: value.post.createdAt,
          id: `asm:${value.post.id}`,
          kind: "asm",
          value,
        });
      }
    }
  }
  return result;
}

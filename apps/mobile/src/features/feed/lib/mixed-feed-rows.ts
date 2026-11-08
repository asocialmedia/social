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

// Identity comparison for the stabilization in the list: same order, same
// row objects, so the memoized row skips the pass entirely.
export function areTimelineRowsIdentical(
  a: readonly TimelineRow[],
  b: readonly TimelineRow[]
): boolean {
  return a.length === b.length && a.every((row, index) => row === b[index]);
}

// Row-identity stabilizer for FlashList memoization. Recomputes (view-count
// reconciles, exposure writes, Bluesky polls) rebuild every row wrapper even
// when the underlying post is untouched, which defeats the memoized row and
// re-renders every mounted card mid-scroll. Reuse the previous row object
// whenever the same id carries the same post reference and thread flags, so
// only genuinely changed rows re-render. Order follows `next`.
export function stableTimelineRows(
  previous: readonly TimelineRow[],
  next: readonly TimelineRow[]
): TimelineRow[] {
  if (previous.length === 0) {
    return [...next];
  }
  const byId = new Map<string, TimelineRow>();
  for (const row of previous) {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  }
  let reused = 0;
  const result = next.map((row) => {
    const prior = byId.get(row.id);
    if (!prior || prior.kind !== row.kind) {
      return row;
    }
    if (row.kind === "asm" && prior.kind === "asm") {
      if (
        prior.value.post === row.value.post &&
        prior.value.hasThreadChild === row.value.hasThreadChild &&
        prior.value.hasThreadParent === row.value.hasThreadParent &&
        prior.createdAt === row.createdAt
      ) {
        reused += 1;
        return prior;
      }
      return row;
    }
    if (prior.value === row.value && prior.createdAt === row.createdAt) {
      reused += 1;
      return prior;
    }
    return row;
  });
  // Every row is new (first load, source switch): skip the copy.
  if (reused === 0 && previous.length !== next.length) {
    return [...next];
  }
  return result;
}

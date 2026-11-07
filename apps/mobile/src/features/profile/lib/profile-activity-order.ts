import type { FeedPost } from "@/features/feed/lib/feed-types";
import { insertionOrder } from "@/features/feed/lib/feed-types";

import type { ExternalProfileActivityItem } from "./profile-activity-schema";
import type { ProfileFeedItem } from "./profile-feed-rows";
import type { ProfileReply } from "./profile-view-model";

// Port of apps/web/src/lib/posts/profile-activity-order.ts. Two cursor-paged
// sources (native ASM rows and Bluesky activity) are interleaved newest first.
// A row is only shown once every source that still has pages has read past
// it, so a later page from the other source can never slot in above rows the
// viewer has already seen.
export interface ProfileActivitySource {
  hasNextPage: boolean | undefined;
  boundary?: string | Date | null;
  pending?: boolean;
}

function activityBoundary(source: ProfileActivitySource) {
  const at = source.boundary
    ? new Date(source.boundary).getTime()
    : Number.POSITIVE_INFINITY;
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

function activityFrontier(sources: readonly ProfileActivitySource[]) {
  return sources.some((source) => source.pending)
    ? Number.POSITIVE_INFINITY
    : Math.max(
        ...sources.filter((source) => source.hasNextPage).map(activityBoundary)
      );
}

export function profileActivityOrder<
  T extends { id: string; type: string; at: string },
>(rows: T[], sources: readonly ProfileActivitySource[] = []): T[] {
  const frontier = activityFrontier(sources);
  // Hold the boundary timestamp too: unread records can share it with another ID.
  // insertionOrder instead of web's toSorted: the native feed code keeps
  // sorting on the Hermes-safe merge sort.
  return insertionOrder(
    [
      ...new Map(rows.map((row) => [`${row.type}:${row.id}`, row])).values(),
    ].filter((row) => Date.parse(row.at) > frontier),
    (first, second) =>
      Date.parse(second.at) - Date.parse(first.at) ||
      first.id.localeCompare(second.id)
  );
}

export function advanceProfileActivity(
  sources: readonly ProfileActivitySource[]
) {
  const frontier = activityFrontier(sources);
  return sources.map(
    (source) =>
      !sources.some((entry) => entry.pending) &&
      Boolean(source.hasNextPage) &&
      activityBoundary(source) === frontier
  );
}

// Amplified rows sort by when the profile amplified the post, not when the
// post was written. The API adds amplifiedAt to each post; FeedPost does not
// declare it, so it is read defensively, the same way web does.
export function nativeActivityAt(value: FeedPost | ProfileReply): string {
  if ("amplifiedAt" in value && typeof value.amplifiedAt === "string") {
    return value.amplifiedAt;
  }
  return String(value.createdAt);
}

function activityRow(item: ProfileFeedItem) {
  if (item.kind === "external") {
    return {
      at: item.value.createdAt,
      id: item.value.id,
      item,
      type: "external",
    };
  }
  if (item.kind === "media") {
    return {
      at: item.value.createdAt,
      id: item.value.id,
      item,
      type: "native",
    };
  }
  return {
    at: nativeActivityAt(item.value),
    id: item.value.id,
    item,
    type: "native",
  };
}

export interface ProfileActivityMerge {
  advanceExternal: boolean;
  advanceNative: boolean;
  items: ProfileFeedItem[];
}

// Builds the merged Amplified or Eddies list from the native rows and the
// Bluesky activity pages, plus which source the next scroll should page.
export function mergeProfileActivity({
  external,
  native,
}: {
  external: ProfileActivitySource & { items: ExternalProfileActivityItem[] };
  native: ProfileActivitySource & { items: ProfileFeedItem[] };
}): ProfileActivityMerge {
  const sources: ProfileActivitySource[] = [
    {
      boundary: native.boundary,
      hasNextPage: native.hasNextPage,
      pending: native.pending,
    },
    {
      boundary: external.boundary,
      hasNextPage: external.hasNextPage,
      pending: external.pending,
    },
  ];
  const [advanceNative = false, advanceExternal = false] =
    advanceProfileActivity(sources);
  const rows = [
    ...native.items,
    ...external.items.map((value): ProfileFeedItem => ({
      kind: "external",
      value,
    })),
  ].map(activityRow);
  return {
    advanceExternal,
    advanceNative,
    items: profileActivityOrder(rows, sources).map((row) => row.item),
  };
}

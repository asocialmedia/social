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
  return [
    ...new Map(rows.map((row) => [`${row.type}:${row.id}`, row])).values(),
  ]
    .filter((row) => Date.parse(row.at) > frontier)
    .toSorted(
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

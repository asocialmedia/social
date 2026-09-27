// When an on-demand list page may be read again. The index is written
// continuously by the backfill while pages read it, so pages re-read per
// generation with a floor between reads. Extracted pure (no React) so the
// scheduling edge cases are unit-testable.

import type { SearchIndexCursor } from "./search-index-format";

export type PageReadDecision =
  | { kind: "read" }
  | { kind: "current" }
  | { kind: "wait"; waitMs: number };

export function decidePageRead(input: {
  // Generation the page's last COMPLETED read used. Failures record nothing,
  // so they retry at once.
  readGeneration?: number;
  readAt?: number;
  generation: number;
  minIntervalMs: number;
  now: number;
}): PageReadDecision {
  if (input.readGeneration === input.generation) {
    return { kind: "current" };
  }
  if (input.readGeneration === undefined || input.readAt === undefined) {
    return { kind: "read" };
  }
  const waitMs = input.minIntervalMs - (input.now - input.readAt);
  return waitMs > 0 ? { kind: "wait", waitMs } : { kind: "read" };
}

// Keyset boundary for the first on-demand page: the oldest match already SHOWN
// on the page before it, in (createdAt, row) order, newest first. Falls back to
// the oldest row in the whole window when the head's slice is entirely
// in-memory matches the index window does not hold.
export function headPageCursor(input: {
  shownMessageIds: ReadonlySet<string>;
  windowRows: ReadonlyMap<
    number,
    { createdAt: number; messageId: string; preview: string }
  >;
}): SearchIndexCursor | null {
  let oldestShown: SearchIndexCursor | null = null;
  let oldestInWindow: SearchIndexCursor | null = null;
  for (const [row, facts] of input.windowRows) {
    const cursor: SearchIndexCursor = {
      createdAt: facts.createdAt,
      row,
    };
    if (oldestInWindow === null || isOlder(cursor, oldestInWindow)) {
      oldestInWindow = cursor;
    }
    if (
      input.shownMessageIds.has(facts.messageId) &&
      (oldestShown === null || isOlder(cursor, oldestShown))
    ) {
      oldestShown = cursor;
    }
  }
  return oldestShown ?? oldestInWindow;
}

// Older of two cursors: the one a page turn starts below. Higher row id is
// older on ties, matching `selectNewestFirstWindow`.
function isOlder(left: SearchIndexCursor, right: SearchIndexCursor): boolean {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt;
  }
  return left.row > right.row;
}

// What a page turn should do, decided before any I/O.
export type PageRequestDecision =
  | { kind: "skip" }
  | { kind: "read"; afterMatch?: SearchIndexCursor }
  | { kind: "current" }
  | { kind: "wait"; waitMs: number }
  | { kind: "await-previous" }
  | { kind: "unreachable" }
  | { kind: "exhausted" };

export function decidePageRequest(input: {
  // Where this page's read starts. Page 1 reads from the head boundary, deeper
  // pages from the page before. Null past page 1 means no seam to start from.
  afterMatch?: SearchIndexCursor | null;
  generation: number;
  previousHasMore?: boolean;
  // Generation the page before last completed. Absent means never read.
  previousReadGeneration?: number;
  // Only the two states that change the answer are named; "loaded" and
  // undefined both mean a seam is expected.
  previousState?: "failed" | "loading";
  // Page being turned to. 0 is the head.
  page: number;
  ready: boolean;
  readGeneration?: number;
  readAt?: number;
  minIntervalMs: number;
  now: number;
}): PageRequestDecision {
  if (!input.ready || input.page <= 0) {
    return { kind: "skip" };
  }
  const { afterMatch } = input;
  if (input.page > 1 && afterMatch === null) {
    if (input.previousState === "loading") {
      return { kind: "await-previous" };
    }
    return { kind: "unreachable" };
  }
  // "Nothing past the previous page" only counts from a CURRENT read. A stale
  // verdict from early in a backfill would strand matches the walk has not
  // reached yet.
  if (
    input.page > 1 &&
    input.previousHasMore === false &&
    input.previousReadGeneration === input.generation
  ) {
    return { kind: "exhausted" };
  }
  const decision = decidePageRead({
    generation: input.generation,
    minIntervalMs: input.minIntervalMs,
    now: input.now,
    readAt: input.readAt,
    readGeneration: input.readGeneration,
  });
  if (decision.kind === "current") {
    return { kind: "current" };
  }
  if (decision.kind === "wait") {
    return { kind: "wait", waitMs: decision.waitMs };
  }
  return afterMatch === null || afterMatch === undefined
    ? { kind: "read" }
    : { afterMatch, kind: "read" };
}

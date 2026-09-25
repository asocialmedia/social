// Keeps the local search index inside a storage budget.
//
// Why this exists: the index is cheap per conversation (measured 17.6MB for a
// 200k-message conversation, about a fifth of what those messages cost to move)
// but it is unbounded across conversations. A user with a hundred long-running
// DMs would accumulate gigabytes, and browsers do not fail gracefully when an
// origin fills up: Chrome evicts the whole origin, Safari may too, and until this
// existed a full disk made search quietly stop working forever while the UI kept
// saying "No matches yet" with no explanation.
//
// Policy, and why:
//
// - Budget in ROWS, not bytes. Per-conversation byte accounting needs a scan of
//   every posting list, which is the expensive operation this design exists to
//   avoid. The row allocator already knows each conversation's size, and rows
//   convert to bytes at a stable rate (measured ~88 bytes per row on disk
//   including its id and timestamp), so a row budget is a byte budget without
//   the scan.
// - Least-recently-used. A conversation the user searched this week is worth more
//   than one they abandoned last year, and an evicted index is rebuildable by
//   walking, so the cost of eviction is a slower first search, not lost data.
// - Never evict the conversation being used. Evicting the active thread would
//   drop the very results on screen.
// - Ties break toward the smaller conversation, so a budget is met without
//   discarding more than necessary when two conversations were last touched in
//   the same millisecond.

import type { SearchIndexConversationSummary } from "./search-index-format";

// Measured on a realistic corpus: 17.6MB of index for 200,000 rows, so ~92 bytes
// per row including interned ids, timestamps, posting lists and key strings.
export const SEARCH_INDEX_BYTES_PER_ROW = 92;

// Default ceiling. 200k rows is about 18MB, which sits comfortably inside a
// phone's per-origin budget while still covering a very large single
// conversation. A user who indexes one 200k DM uses the whole budget, which is
// the intended trade: the conversation they care about is the one that survives.
export const DEFAULT_SEARCH_INDEX_ROW_BUDGET = 200_000;

export interface EvictionPlan {
  // Conversations to clear, least-recently-used first.
  evict: string[];
  // Rows freed by the plan.
  freedRows: number;
  // Rows still indexed after the plan.
  remainingRows: number;
  // True when even evicting everything else leaves the budget exceeded, which
  // happens when the active conversation alone is over budget. Not an error: the
  // active conversation is never evicted, so the index simply stays over budget
  // until it shrinks.
  overBudgetAfterEviction: boolean;
}

export interface PlanEvictionInput {
  // Ceiling in rows. Defaults to DEFAULT_SEARCH_INDEX_ROW_BUDGET.
  rowBudget?: number;
  summaries: SearchIndexConversationSummary[];
  // Never evicted, whatever the budget says.
  activeConversationId: string | null;
}

// Chooses which conversations to clear. Pure, so the policy is testable without
// a storage backend and without a device.
export function planSearchIndexEviction(
  input: PlanEvictionInput
): EvictionPlan {
  const {
    activeConversationId,
    rowBudget = DEFAULT_SEARCH_INDEX_ROW_BUDGET,
    summaries,
  } = input;
  let remainingRows = summaries.reduce(
    (sum, summary) => sum + summary.indexedRowCount,
    0
  );
  if (remainingRows <= rowBudget) {
    return {
      evict: [],
      freedRows: 0,
      overBudgetAfterEviction: false,
      remainingRows,
    };
  }

  const candidates = summaries
    .filter((summary) => summary.conversationId !== activeConversationId)
    .toSorted((left, right) => {
      if (left.lastAccessedAt !== right.lastAccessedAt) {
        return left.lastAccessedAt - right.lastAccessedAt;
      }
      // Same millisecond: drop the smaller one first, so the budget is met
      // without discarding more conversation than necessary.
      return left.indexedRowCount - right.indexedRowCount;
    });

  const evict: string[] = [];
  let freedRows = 0;
  for (const candidate of candidates) {
    if (remainingRows - freedRows <= rowBudget) {
      break;
    }
    evict.push(candidate.conversationId);
    freedRows += candidate.indexedRowCount;
  }

  remainingRows -= freedRows;
  return {
    evict,
    freedRows,
    // Only over budget if the active conversation alone exceeds it.
    overBudgetAfterEviction: remainingRows > rowBudget,
    remainingRows,
  };
}

// Human-readable size for the coverage and storage surfaces. Bytes, not MiB:
// the numbers involved are small enough that rounding to a decimal keeps the
// difference visible between 0.4MB and 0.9MB.
export function formatSearchIndexBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.max(0, Math.round(bytes))}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

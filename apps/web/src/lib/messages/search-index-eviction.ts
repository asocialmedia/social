// Keeps the local search index inside a storage budget.
//
// Budget is in ROWS, not bytes: per-conversation byte accounting would need a
// scan of every posting list. Rows convert at a stable rate (~92 bytes/row on
// the 200k fixture), LRU by last access, never evicting the active
// conversation. Eviction costs a re-walk, not data loss.

import type { SearchIndexConversationSummary } from "./search-index-format";

// ~92 bytes/row on the 200k fixture (format 6). KNOWN STALE: format 7 adds one
// float per posting (~2M postings), so the true cost is nearer 200 bytes.
// Conservative on purpose: evicts early (a re-walk) rather than risking quota.
// See `search-slo.ts` for the re-measurement note.
export const SEARCH_INDEX_BYTES_PER_ROW = 92;

// 200k rows is ~18MB: comfortable inside a phone per-origin budget while still
// covering a very large single conversation.
export const DEFAULT_SEARCH_INDEX_ROW_BUDGET = 200_000;

export interface EvictionPlan {
  evict: string[];
  freedRows: number;
  remainingRows: number;
  // True when the active conversation alone exceeds the budget. Not an error:
  // the active conversation is never evicted.
  overBudgetAfterEviction: boolean;
}

export interface PlanEvictionInput {
  rowBudget?: number;
  summaries: SearchIndexConversationSummary[];
  // Never evicted, whatever the budget says.
  activeConversationId: string | null;
}

// Chooses which conversations to clear. Pure and LRU; ties drop the smaller
// conversation first.
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
    overBudgetAfterEviction: remainingRows > rowBudget,
    remainingRows,
  };
}

// Human-readable size for the coverage and storage surfaces.
export function formatSearchIndexBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.max(0, Math.round(bytes))}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

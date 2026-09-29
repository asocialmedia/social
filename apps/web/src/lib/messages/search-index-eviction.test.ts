import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SEARCH_INDEX_ROW_BUDGET,
  formatSearchIndexBytes,
  planSearchIndexEviction,
  SEARCH_INDEX_BYTES_PER_ROW,
} from "./search-index-eviction";
import type { SearchIndexConversationSummary } from "./search-index-format";

function summary(
  conversationId: string,
  indexedRowCount: number,
  lastAccessedAt: number
): SearchIndexConversationSummary {
  return { conversationId, indexedRowCount, lastAccessedAt };
}

describe("planSearchIndexEviction", () => {
  test("evicts nothing while the index is inside the budget", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: "c1",
      rowBudget: 1000,
      summaries: [summary("c1", 400, 10), summary("c2", 300, 20)],
    });
    expect(plan.evict).toEqual([]);
    expect(plan.remainingRows).toBe(700);
    expect(plan.overBudgetAfterEviction).toBe(false);
  });

  test("evicts the least recently used conversation first", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: "c1",
      rowBudget: 500,
      summaries: [
        summary("c1", 100, 99),
        summary("old", 400, 1),
        summary("recent", 400, 50),
      ],
    });
    expect(plan.evict).toEqual(["old"]);
    expect(plan.freedRows).toBe(400);
    expect(plan.remainingRows).toBe(500);
  });

  test("keeps evicting until the budget is met", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: "active",
      rowBudget: 200,
      summaries: [
        summary("active", 50, 99),
        summary("a", 300, 1),
        summary("b", 300, 2),
        summary("c", 300, 3),
      ],
    });
    // Evicting only a and b leaves 350, still over the 200 budget, so the walk
    // continues rather than stopping at the first thing it can drop.
    expect(plan.evict).toEqual(["a", "b", "c"]);
    expect(plan.remainingRows).toBe(50);
  });

  // Evicting the conversation on screen would drop the results the user is
  // looking at, so it is never a candidate however far over budget the index is.
  test("never evicts the active conversation", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: "active",
      rowBudget: 10,
      summaries: [summary("active", 500, 99), summary("other", 500, 1)],
    });
    expect(plan.evict).toEqual(["other"]);
    expect(plan.remainingRows).toBe(500);
    // Reported rather than hidden: the active conversation alone is over budget,
    // so the index stays large until that conversation shrinks.
    expect(plan.overBudgetAfterEviction).toBe(true);
  });

  test("reports over-budget when there is nothing left to evict", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: "only",
      rowBudget: 10,
      summaries: [summary("only", 999, 1)],
    });
    expect(plan.evict).toEqual([]);
    expect(plan.overBudgetAfterEviction).toBe(true);
  });

  test("a conversation never touched sorts oldest", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: null,
      rowBudget: 100,
      summaries: [summary("touched", 200, 5), summary("never", 200, 0)],
    });
    expect(plan.evict[0]).toBe("never");
  });

  test("ties break toward evicting the smaller conversation first", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: null,
      rowBudget: 900,
      summaries: [summary("big", 900, 7), summary("small", 100, 7)],
    });
    // Same millisecond: dropping the small one meets the budget on its own. Had
    // the tie broken the other way, "big" would have gone and 900 rows would have
    // been discarded to no purpose.
    expect(plan.evict).toEqual(["small"]);
  });

  test("no active conversation evicts purely by recency", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: null,
      rowBudget: 300,
      summaries: [
        summary("a", 200, 1),
        summary("b", 200, 2),
        summary("c", 200, 3),
      ],
    });
    expect(plan.evict).toEqual(["a", "b"]);
  });

  test("an empty index plans no eviction", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: "c1",
      summaries: [],
    });
    expect(plan.evict).toEqual([]);
    expect(plan.remainingRows).toBe(0);
  });

  test("defaults to the shared row budget", () => {
    const plan = planSearchIndexEviction({
      activeConversationId: null,
      summaries: [
        summary("a", DEFAULT_SEARCH_INDEX_ROW_BUDGET, 2),
        summary("b", DEFAULT_SEARCH_INDEX_ROW_BUDGET, 1),
      ],
    });
    expect(plan.evict).toEqual(["b"]);
  });
});

describe("search index budget sizing", () => {
  // The budget is expressed in rows because per-conversation byte accounting
  // needs a scan of every posting list, which is the operation this design avoids.
  // These pin the conversion the UI and the docs quote.
  test("the default budget is about 18MB at the measured rate", () => {
    const bytes = DEFAULT_SEARCH_INDEX_ROW_BUDGET * SEARCH_INDEX_BYTES_PER_ROW;
    const formatted = formatSearchIndexBytes(bytes);
    // 17.5-17.6MB depending on rounding; the point is the magnitude, and that it
    // matches the 200k benchmark's 17.6MB.
    expect(formatted.endsWith("MB")).toBe(true);
    // The unit is stripped first: Number("17.5MB") is NaN.
    const magnitude = Number(formatted.replace("MB", ""));
    expect(magnitude).toBeGreaterThan(17);
    expect(magnitude).toBeLessThan(18);
  });

  test("the measured rate matches the 200k benchmark", () => {
    // 17.6MB for 200,000 rows, rounded.
    // Deliberately the stale-conservative number rather than a measured format 7
    // figure. See the note on the constant: budgeting low costs a re-walk, and
    // budgeting high would let a phone fill its origin quota. Re-measure with
    // `bun run bench:search` before changing it.
    expect(SEARCH_INDEX_BYTES_PER_ROW).toBe(92);
  });
});

describe("formatSearchIndexBytes", () => {
  test("scales the unit to the magnitude", () => {
    expect(formatSearchIndexBytes(0)).toBe("0B");
    expect(formatSearchIndexBytes(512)).toBe("512B");
    expect(formatSearchIndexBytes(2048)).toBe("2.0KB");
    expect(formatSearchIndexBytes(5 * 1024 * 1024)).toBe("5.0MB");
  });

  test("never reports a negative size", () => {
    expect(formatSearchIndexBytes(-100)).toBe("0B");
  });
});

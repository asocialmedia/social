import { describe, expect, test } from "bun:test";

import type { DurableMessageChange } from "@asm/messages";

import {
  createSessionCursorStorage,
  planChangeReplay,
} from "./change-replay-plan";

function change(
  messageId: string | null,
  sequence: number,
  overrides: Partial<DurableMessageChange> = {}
): DurableMessageChange {
  return {
    globallyDeleted: false,
    hiddenForViewer: false,
    id: `change-${sequence}`,
    kind: "message.edited",
    messageId,
    revision: sequence,
    sequence,
    sourceAvailable: true,
    sourceRevision: sequence + 10,
    ...overrides,
  };
}

const loaded = new Set(["a", "b", "c"]);

describe("planChangeReplay", () => {
  test("an edit on a loaded row re-reads it at the source revision", () => {
    expect(planChangeReplay([change("a", 1)], false, loaded).refetch).toEqual([
      { id: "a", revision: 11 },
    ]);
  });

  test("only the latest change per message counts", () => {
    const plan = planChangeReplay(
      [change("a", 1), change("a", 2, { globallyDeleted: true })],
      false,
      loaded
    );
    expect(plan.deleteIds).toEqual(["a"]);
    expect(plan.refetch).toEqual([]);
  });

  test("hidden or unreadable rows leave the window", () => {
    const plan = planChangeReplay(
      [
        change("a", 1, { hiddenForViewer: true }),
        change("b", 2, { sourceAvailable: false }),
      ],
      false,
      loaded
    );
    expect(plan.removeIds).toEqual(["a", "b"]);
  });

  test("rows outside the window and plain creations need nothing", () => {
    const plan = planChangeReplay(
      [change("z", 1), change("c", 2, { kind: "message.created" })],
      false,
      loaded
    );
    expect(plan).toEqual({
      deleteIds: [],
      refetch: [],
      removeIds: [],
      reset: false,
    });
  });

  test("an access change or expired cursor resets the window", () => {
    expect(planChangeReplay([change(null, 1)], false, loaded).reset).toBe(true);
    expect(planChangeReplay([], true, loaded).reset).toBe(true);
  });
});

test("session cursor storage keeps one value per key and clears", () => {
  const storage = createSessionCursorStorage();
  storage.setItem("k", "v");
  expect(storage.getItem("k")).toBe("v");
  storage.clear();
  expect(storage.getItem("k")).toBeNull();
});

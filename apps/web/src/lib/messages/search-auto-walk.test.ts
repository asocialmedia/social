import { describe, expect, test } from "bun:test";

import { shouldAutoStartWalk } from "./search-auto-walk";
import type { ShouldAutoStartWalkInput } from "./search-auto-walk";

function input(
  overrides: Partial<ShouldAutoStartWalkInput> = {}
): ShouldAutoStartWalkInput {
  return {
    autoIndex: true,
    coverage: null,
    persistedChainVerified: false,
    persistedCovered: false,
    persistedRefsCovered: false,
    running: false,
    storeReady: true,
    wantsIndexing: true,
    writerReady: true,
    ...overrides,
  };
}

describe("shouldAutoStartWalk", () => {
  test("starts on a fresh session over partially covered history", () => {
    expect(shouldAutoStartWalk(input())).toBe(true);
  });

  test("stays quiet when nothing is asking for history-wide results", () => {
    // The details panel is the second caller: while it is open the same walk
    // runs, so a fresh device that opens the panel and searches once does not pay
    // for two walks over the same history.
    expect(shouldAutoStartWalk(input({ wantsIndexing: false }))).toBe(false);
  });

  test("waits for the store and the writer instead of no-op starting", () => {
    expect(shouldAutoStartWalk(input({ storeReady: false }))).toBe(false);
    expect(shouldAutoStartWalk(input({ writerReady: false }))).toBe(false);
  });

  test("never starts a second run over a running one", () => {
    expect(shouldAutoStartWalk(input({ running: true }))).toBe(false);
  });

  test("a disabled flag holds the walk off", () => {
    expect(shouldAutoStartWalk(input({ autoIndex: false }))).toBe(false);
  });

  test("a covered conversation costs nothing, not even a probe", () => {
    expect(
      shouldAutoStartWalk(
        input({
          coverage: null,
          persistedChainVerified: true,
          persistedCovered: true,
          persistedRefsCovered: true,
        })
      )
    ).toBe(false);
    expect(
      shouldAutoStartWalk(
        input({
          coverage: {
            reachedStart: true,
            refsReachedStart: true,
            state: "done",
          },
          persistedCovered: false,
        })
      )
    ).toBe(false);
  });

  // The bug this half exists for. Refs were added after the coverage verdict was,
  // so a conversation indexed by an older build carries `reachedStart: true` over
  // an EMPTY refs store. The walk skips it -- correctly, the text IS covered -- and
  // the details pane then reports "no media" for a conversation full of it,
  // permanently. Treating a missing refs half as "not covered" is what repairs it,
  // and the user does nothing: the pane is a consumer on desktop, so the walk
  // starts on entry and the next open finds the marker.
  test("a text-covered conversation with no refs verdict re-walks once", () => {
    expect(
      shouldAutoStartWalk(
        input({
          coverage: null,
          persistedChainVerified: true,
          persistedCovered: true,
          persistedRefsCovered: false,
        })
      )
    ).toBe(true);
  });

  test("an ABSENT refs half is unknown, not a definite false", () => {
    // The distinction that decides the above. A record written before the field
    // existed has no `refsReachedStart` at all, and reading that as a definite
    // "not covered" would be right once and wrong forever: the walk would restart
    // on every open of a fully covered conversation. Absent has to mean "wait",
    // exactly as it does for the other two halves.
    const withoutTheField = {
      autoIndex: true,
      coverage: null,
      persistedChainVerified: true,
      persistedCovered: true,
      running: false,
      storeReady: true,
      wantsIndexing: true,
      writerReady: true,
    } as ShouldAutoStartWalkInput;
    expect(shouldAutoStartWalk(withoutTheField)).toBe(false);
  });

  test("does not immediately restart at the end when refs remain incomplete", () => {
    // Reached the start, but refs did not settle. The incomplete verdict remains
    // visible for retry; repeatedly fetching the empty terminal page would spin.
    expect(
      shouldAutoStartWalk(
        input({
          coverage: {
            reachedStart: true,
            refsReachedStart: false,
            state: "done",
          },
          persistedChainVerified: true,
          persistedCovered: true,
          persistedRefsCovered: true,
        })
      )
    ).toBe(false);
  });

  test("waits for the refs verdict before the first start", () => {
    expect(
      shouldAutoStartWalk(input({ coverage: null, persistedRefsCovered: null }))
    ).toBe(false);
  });

  test("waits for the persisted verdict before the first start", () => {
    expect(
      shouldAutoStartWalk(input({ coverage: null, persistedCovered: null }))
    ).toBe(false);
    expect(
      shouldAutoStartWalk(
        input({ coverage: null, persistedChainVerified: null })
      )
    ).toBe(false);
  });

  // A covered flag without a vouched chain is a legacy row: resuming from its
  // cursor would strand everything above it, so the next run descends from
  // the top once to earn the mark.
  test("a covered-but-unverified verdict starts one healing run", () => {
    expect(
      shouldAutoStartWalk(
        input({
          coverage: null,
          persistedChainVerified: false,
          persistedCovered: true,
        })
      )
    ).toBe(true);
  });

  test("a yielded run chains, failed and stopped runs do not", () => {
    expect(
      shouldAutoStartWalk(
        input({ coverage: { reachedStart: false, state: "done" } })
      )
    ).toBe(true);
    for (const state of ["failed", "stopped", "running", "idle"] as const) {
      expect(
        shouldAutoStartWalk(input({ coverage: { reachedStart: false, state } }))
      ).toBe(false);
    }
  });
});

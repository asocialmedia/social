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
    running: false,
    searchOpen: true,
    storeReady: true,
    writerReady: true,
    ...overrides,
  };
}

describe("shouldAutoStartWalk", () => {
  test("starts on a fresh search session over partially covered history", () => {
    expect(shouldAutoStartWalk(input())).toBe(true);
  });

  test("stays quiet when search is closed", () => {
    expect(shouldAutoStartWalk(input({ searchOpen: false }))).toBe(false);
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
        })
      )
    ).toBe(false);
    expect(
      shouldAutoStartWalk(
        input({
          coverage: { reachedStart: true, state: "done" },
          persistedCovered: false,
        })
      )
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

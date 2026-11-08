import { describe, expect, test } from "bun:test";

import { MutationGenerations } from "./mutation-generations";

describe("MutationGenerations", () => {
  test("a newer vote invalidates the earlier one", () => {
    const guards = new MutationGenerations();
    const first = guards.begin("vote");
    const second = guards.begin("vote");
    expect(guards.isCurrent("vote", first)).toBe(false);
    expect(guards.isCurrent("vote", second)).toBe(true);
  });

  test("an intervening vote does not invalidate a bookmark attempt", () => {
    const guards = new MutationGenerations();
    const bookmark = guards.begin("bookmark");
    guards.begin("vote");
    // The old shared counter returned false here, so a bookmark error after
    // an intervening vote skipped its rollback and left phantom state.
    expect(guards.isCurrent("bookmark", bookmark)).toBe(true);
  });

  test("an intervening bookmark does not invalidate a vote attempt", () => {
    const guards = new MutationGenerations();
    const vote = guards.begin("vote");
    guards.begin("bookmark");
    expect(guards.isCurrent("vote", vote)).toBe(true);
  });
});

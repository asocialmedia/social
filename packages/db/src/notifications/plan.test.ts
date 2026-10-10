import { describe, expect, test } from "bun:test";

import { planFoldedNotification } from "./plan";

describe("planFoldedNotification", () => {
  test("folds recipients who already have an unread row", () => {
    const { fold, fresh } = planFoldedNotification(["a", "b", "c"], ["a", "c"]);
    expect(fold).toEqual(["a", "c"]);
    expect(fresh).toEqual(["b"]);
  });

  test("every recipient is fresh when nothing is unread", () => {
    const { fold, fresh } = planFoldedNotification(["a", "b"], []);
    expect(fold).toEqual([]);
    expect(fresh).toEqual(["a", "b"]);
  });

  test("every recipient folds when all already have an unread row", () => {
    const { fold, fresh } = planFoldedNotification(["a", "b"], ["a", "b"]);
    expect(fold).toEqual(["a", "b"]);
    expect(fresh).toEqual([]);
  });

  test("no recipients yields nothing", () => {
    expect(planFoldedNotification([], [])).toEqual({ fold: [], fresh: [] });
  });

  test("an unread row outside the audience folds nobody else", () => {
    // The caller passes only the rows for THIS subject and only for the
    // audience, so an unread row belonging to somebody who is not being notified
    // can never appear in the fold set, and cannot drag an uninvolved recipient
    // into it.
    const { fold, fresh } = planFoldedNotification(
      ["a", "b"],
      ["a", "someone-elses-conversation"]
    );
    expect(fold).toEqual(["a"]);
    expect(fresh).toEqual(["b"]);
  });
});

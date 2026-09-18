import { describe, expect, test } from "bun:test";

import { planCommunityNotification } from "./notification-plan";

describe("planCommunityNotification", () => {
  test("folds recipients who already have an unread row", () => {
    const { fold, fresh } = planCommunityNotification(
      ["a", "b", "c"],
      ["a", "c"]
    );
    expect(fold).toEqual(["a", "c"]);
    expect(fresh).toEqual(["b"]);
  });

  test("every recipient is fresh when nothing is unread", () => {
    const { fold, fresh } = planCommunityNotification(["a", "b"], []);
    expect(fold).toEqual([]);
    expect(fresh).toEqual(["a", "b"]);
  });

  test("every recipient folds when all already have an unread row", () => {
    const { fold, fresh } = planCommunityNotification(["a", "b"], ["a", "b"]);
    expect(fold).toEqual(["a", "b"]);
    expect(fresh).toEqual([]);
  });

  test("no recipients yields nothing", () => {
    expect(planCommunityNotification([], [])).toEqual({ fold: [], fresh: [] });
  });
});

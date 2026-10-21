import { expect, test } from "bun:test";

import type { ExploreData } from "./explore-cache";
import { exploreDisplayStatus } from "./explore-display-status";

const emptyPage: ExploreData = {
  communities: [],
  gusts: [],
  nextCursor: null,
  posts: [],
  users: [],
};

test("available cards survive a failed or pending peer source", () => {
  expect(
    exploreDisplayStatus(
      true,
      { data: null, error: "ASM unavailable" },
      "success"
    )
  ).toBe("success");
  expect(
    exploreDisplayStatus(true, { data: null, error: null }, "success")
  ).toBe("success");
  expect(
    exploreDisplayStatus(true, { data: emptyPage, error: null }, "error")
  ).toBe("success");
});

test("empty results wait for a healthy pending source before showing a failure", () => {
  expect(
    exploreDisplayStatus(
      false,
      { data: null, error: "ASM unavailable" },
      "loading"
    )
  ).toBe("loading");
  expect(
    exploreDisplayStatus(false, { data: null, error: null }, "error")
  ).toBe("loading");
  expect(
    exploreDisplayStatus(
      false,
      { data: null, error: "ASM unavailable" },
      "success"
    )
  ).toBe("error");
  expect(
    exploreDisplayStatus(false, { data: emptyPage, error: null }, "error")
  ).toBe("error");
});

test("completed empty sources and people browsing settle without a phantom loader", () => {
  expect(
    exploreDisplayStatus(false, { data: emptyPage, error: null }, "success")
  ).toBe("success");
  expect(exploreDisplayStatus(false, { data: emptyPage, error: null })).toBe(
    "success"
  );
  expect(
    exploreDisplayStatus(false, { data: null, error: "ASM unavailable" })
  ).toBe("error");
});

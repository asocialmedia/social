import { expect, test } from "bun:test";

import { dockTabState } from "./dock-navigation";

test("a restored HackerNews page stays selected before session hydration", () => {
  expect(dockTabState("/hackernews", "/hackernews", true, false)).toEqual({
    requiresLogin: true,
    selected: true,
  });
  expect(dockTabState("/hackernews", "/hackernews", true, true)).toEqual({
    requiresLogin: false,
    selected: true,
  });
});

test("nested pages select their section without matching unrelated prefixes", () => {
  expect(
    dockTabState("/messages/thread", "/messages", true, false).selected
  ).toBe(true);
  expect(
    dockTabState("/hackernews-other", "/hackernews", true, true).selected
  ).toBe(false);
  expect(dockTabState("/hackernews", "/", false, true).selected).toBe(false);
  expect(dockTabState("/", "/", false, true).selected).toBe(true);
});

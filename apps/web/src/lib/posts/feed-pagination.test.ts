import { expect, test } from "bun:test";

import { canAutoContinueFeed } from "./feed-pagination";

const items = (page: { id: string }[]) => page;

test("sparse and repeated continuations stop automatic loading without dropping the cursor", () => {
  expect(canAutoContinueFeed([[{ id: "first" }], [], []], items)).toBe(true);
  expect(canAutoContinueFeed([[{ id: "first" }], [], [], []], items)).toBe(
    false
  );
  expect(
    canAutoContinueFeed([[{ id: "first" }], [{ id: "first" }], [], []], items)
  ).toBe(false);
  expect(
    canAutoContinueFeed(
      [[{ id: "first" }], [], [], [], [{ id: "next" }]],
      items
    )
  ).toBe(true);
});

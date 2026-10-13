import { expect, test } from "bun:test";

import { visibleTabScrollOffset } from "@asm/ui/lib/tab-scroll";

test("reveals the complete selected tab after its active padding expands", () => {
  expect(
    visibleTabScrollOffset({
      itemLeft: 280,
      itemWidth: 168,
      offset: 0,
      viewportWidth: 390,
    })
  ).toBe(66);
  expect(
    visibleTabScrollOffset({
      itemLeft: 280,
      itemWidth: 168,
      offset: 66,
      viewportWidth: 320,
    })
  ).toBe(136);
});

test("scrolls back to an earlier tab and leaves a fully visible tab alone", () => {
  expect(
    visibleTabScrollOffset({
      itemLeft: 0,
      itemWidth: 90,
      offset: 136,
      viewportWidth: 320,
    })
  ).toBe(0);
  expect(
    visibleTabScrollOffset({
      itemLeft: 100,
      itemWidth: 90,
      offset: 40,
      viewportWidth: 320,
    })
  ).toBe(40);
  expect(
    visibleTabScrollOffset({
      itemLeft: 100,
      itemWidth: 90,
      offset: 40,
      viewportWidth: 0,
    })
  ).toBe(40);
});

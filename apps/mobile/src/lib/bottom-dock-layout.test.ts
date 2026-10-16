import { describe, expect, test } from "bun:test";

import { bottomDockPadding } from "./bottom-dock-layout";

describe("community list clearance", () => {
  test("clears the measured dock and the system navigation area", () => {
    expect(bottomDockPadding({ bottomInset: 32, dockHeight: 76 })).toBe(144);
    expect(bottomDockPadding({ bottomInset: 0, dockHeight: 56 })).toBe(92);
  });

  test("reserves the guest banner above the dock", () => {
    expect(
      bottomDockPadding({
        bottomInset: 48,
        dockHeight: 90,
        guestBarHeight: 104,
      })
    ).toBe(278);
  });
});

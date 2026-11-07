import { describe, expect, test } from "bun:test";

import { detailsPlacement, showsDetailsRailToggle } from "./details-placement";
import type { DetailsPlacementInput } from "./details-placement";

function input(
  overrides: Partial<DetailsPlacementInput> = {}
): DetailsPlacementInput {
  return {
    collapsed: false,
    desktopViewport: false,
    requested: false,
    ...overrides,
  };
}

describe("detailsPlacement", () => {
  test("desktop pins the rail without being asked", () => {
    expect(detailsPlacement(input({ desktopViewport: true }))).toBe("rail");
  });

  test("desktop does not ALSO open the sheet", () => {
    expect(
      detailsPlacement(input({ desktopViewport: true, requested: true }))
    ).toBe("rail");
  });

  test("below lg the sheet is the surface, and only when requested", () => {
    expect(
      detailsPlacement(input({ desktopViewport: false, requested: true }))
    ).toBe("sheet");
    expect(detailsPlacement(input())).toBe("none");
  });

  test("a folded pane on desktop shows nothing at all", () => {
    expect(
      detailsPlacement(input({ collapsed: true, desktopViewport: true }))
    ).toBe("none");
  });

  test("folding is a desktop state, so it cannot suppress the sheet", () => {
    expect(
      detailsPlacement(
        input({ collapsed: true, desktopViewport: false, requested: true })
      )
    ).toBe("sheet");
  });

  test("the fold control outlives the pane it reopens", () => {
    const folded = input({ collapsed: true, desktopViewport: true });
    expect(detailsPlacement(folded)).toBe("none");
    expect(showsDetailsRailToggle(folded.desktopViewport)).toBe(true);
  });

  test("the fold control is a viewport question, not a placement one", () => {
    expect(showsDetailsRailToggle(false)).toBe(false);
    expect(showsDetailsRailToggle(true)).toBe(true);
  });

  test("every input resolves to exactly one placement", () => {
    for (const desktopViewport of [true, false]) {
      for (const requested of [true, false]) {
        for (const collapsed of [true, false]) {
          const placement = detailsPlacement(
            input({ collapsed, desktopViewport, requested })
          );
          expect(["none", "rail", "sheet"]).toContain(placement);
        }
      }
    }
  });
});

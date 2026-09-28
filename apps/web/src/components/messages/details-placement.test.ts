// The rule that decides which details surface is mounted, and the two things about
// it that are easy to get wrong without noticing.
//
// One: a desktop viewport mounts the rail EVEN IF the sheet was requested, so a sheet
// opened on a phone and then widened does not leave a dialog stacked over the pane
// that is already showing the same thing.
//
// Two: a folded pane is not a narrow pane. It resolves to `none`, because the body is
// the expensive part -- it pages the refs index and asks the decryptor for the loaded
// window -- and a visible sliver is still a mount that keeps both of those running.
//
// The cost of getting either wrong is quiet rather than loud. Both surfaces read the
// refs index and ask the decryptor for the same window, so a double mount doubles
// every read and runs two independent cursors over one store -- a list that looks
// right and pages wrong, with nothing visibly broken.

import { describe, expect, test } from "bun:test";

import { detailsPlacement } from "./details-placement";
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
    // The reachable way into this state: open the sheet on a phone, then widen the
    // window past lg.
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

  // Folding leaves the screen, it does not shrink to a stub. Anything else keeps the
  // body mounted and the walk running for a pane the user put away.
  test("a folded pane on desktop shows nothing at all", () => {
    expect(
      detailsPlacement(input({ collapsed: true, desktopViewport: true }))
    ).toBe("none");
  });

  test("folding is a desktop state, so it cannot suppress the sheet", () => {
    // The fold is only reachable from `lg` up, but the value persists across a
    // resize. If it leaked into the below-lg branch, folding on a desktop and then
    // narrowing would leave a phone with no way to reach the details at all.
    expect(
      detailsPlacement(
        input({ collapsed: true, desktopViewport: false, requested: true })
      )
    ).toBe("sheet");
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

// The rule that decides which details surface is mounted, and the one thing about
// it that is easy to get wrong without noticing: a desktop viewport mounts the
// rail EVEN IF the sheet was requested, so a sheet opened on a phone and then
// widened does not leave a dialog stacked over the pane that is already showing
// the same thing.
//
// The cost of getting this wrong is quiet rather than loud. Both surfaces read
// the refs index and ask the decryptor for the loaded window, so a double mount
// doubles every read and runs two independent cursors over one store — a list
// that looks right and pages wrong, with nothing visibly broken.

import { describe, expect, test } from "bun:test";

import { detailsPlacement } from "./details-placement";

describe("detailsPlacement", () => {
  test("desktop pins the rail without being asked", () => {
    expect(detailsPlacement({ desktopViewport: true, requested: false })).toBe(
      "rail"
    );
  });

  test("desktop does not ALSO open the sheet", () => {
    // The reachable way into this state: open the sheet on a phone, then widen
    // the window past lg.
    expect(detailsPlacement({ desktopViewport: true, requested: true })).toBe(
      "rail"
    );
  });

  test("below lg the sheet is the surface, and only when requested", () => {
    expect(detailsPlacement({ desktopViewport: false, requested: true })).toBe(
      "sheet"
    );
    expect(detailsPlacement({ desktopViewport: false, requested: false })).toBe(
      "none"
    );
  });

  test("every input resolves to exactly one placement", () => {
    for (const desktopViewport of [true, false]) {
      for (const requested of [true, false]) {
        const placement = detailsPlacement({ desktopViewport, requested });
        expect(["none", "rail", "sheet"]).toContain(placement);
      }
    }
  });
});

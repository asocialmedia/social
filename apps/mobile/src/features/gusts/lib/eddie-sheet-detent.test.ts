import { expect, test } from "bun:test";

import { eddieSheetDetent } from "./eddie-sheet-detent";

test("eddie drawer snaps to the nearest visible state", () => {
  expect(eddieSheetDetent(40, 0, 400)).toBe("full");
  expect(eddieSheetDetent(350, 0, 400)).toBe("half");
  expect(eddieSheetDetent(650, 0, 400)).toBe("closed");
});
test("an intentional flick expands or dismisses without dragging the whole screen", () => {
  expect(eddieSheetDetent(350, -1400, 400)).toBe("full");
  expect(eddieSheetDetent(400, 1500, 400)).toBe("closed");
});

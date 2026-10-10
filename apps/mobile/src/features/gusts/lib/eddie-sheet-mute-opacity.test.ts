import { expect, test } from "bun:test";

import { eddieSheetMuteOpacity } from "./eddie-sheet-mute-opacity";

test("preview mute stays visible at the half detent and hides at full screen", () => {
  expect(eddieSheetMuteOpacity(392, 900, 58)).toBe(1);
  expect(eddieSheetMuteOpacity(0, 900, 58)).toBe(0);
  expect(eddieSheetMuteOpacity(28, 900, 58)).toBe(0.5);
});

test("dismissal hides mute before the panel leaves even if React cleanup is delayed", () => {
  expect(eddieSheetMuteOpacity(786, 900, 58)).toBe(1);
  expect(eddieSheetMuteOpacity(814, 900, 58)).toBe(0.5);
  expect(eddieSheetMuteOpacity(842, 900, 58)).toBe(0);
  expect(eddieSheetMuteOpacity(900, 900, 58)).toBe(0);
});

test("visibility stays bounded on short viewports and interrupted drags", () => {
  expect(eddieSheetMuteOpacity(-20, 900, 58)).toBe(0);
  expect(eddieSheetMuteOpacity(940, 900, 58)).toBe(0);
  expect(eddieSheetMuteOpacity(0, 80, 58)).toBe(0);
  expect(eddieSheetMuteOpacity(132, 320, 28)).toBe(1);
});

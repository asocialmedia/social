import { expect, test } from "bun:test";

import { gustPreviewGeometry } from "./preview-geometry";

test("portrait preview fits above the drawer and rounds the actual video bounds", () => {
  const preview = gustPreviewGeometry(400, 900, 50, 9 / 16);
  expect(preview.height).toBe(384);
  expect(preview.width / preview.height).toBe(9 / 16);
  expect(preview.marginTop + preview.height).toBeLessThanOrEqual(442);
});
test("landscape preview fits the width without cropping or spilling into eddies", () => {
  const preview = gustPreviewGeometry(400, 900, 50, 16 / 9);
  expect(preview.width).toBe(384);
  expect(preview.height).toBe(216);
  expect(preview.marginTop + preview.height).toBeLessThan(450);
});

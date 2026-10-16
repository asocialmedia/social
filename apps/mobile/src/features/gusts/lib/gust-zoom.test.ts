import { expect, test } from "bun:test";

import {
  gustZoomHome,
  gustZoomScale,
  gustZoomTransform,
} from "@asm/ui/lib/gust-zoom";

const viewport = {
  mediaHeight: 800,
  mediaWidth: 400,
  viewportHeight: 800,
  viewportWidth: 400,
};

test("pinch keeps the touched media point under the moving focal point", () => {
  const zoom = gustZoomTransform({
    ...viewport,
    anchorX: 40,
    anchorY: -80,
    focalX: 240,
    focalY: 320,
    scale: 2,
  });
  expect(zoom).toEqual({ scale: 2, x: -40, y: 80 });
  expect(200 + zoom.x + 40 * zoom.scale).toBe(240);
  expect(400 + zoom.y - 80 * zoom.scale).toBe(320);
});

test("zoom cannot pan beyond the media edges or shrink below the original size", () => {
  expect(
    gustZoomTransform({
      ...viewport,
      anchorX: 0,
      anchorY: 0,
      focalX: 9999,
      focalY: -9999,
      scale: 2,
    })
  ).toEqual({ scale: 2, x: 200, y: -400 });
  expect(
    gustZoomTransform({
      ...viewport,
      anchorX: 400,
      anchorY: 800,
      focalX: 0,
      focalY: 0,
      scale: 1.015,
    })
  ).toEqual({ scale: 1, x: 0, y: 0 });
  expect(gustZoomScale(20)).toBe(4);
  expect(gustZoomScale(Number.NaN)).toBe(1);
});

test("original-size feedback only fires once and small boundary jitter cannot rearm it", () => {
  let armed = false;
  let resets = 0;
  for (const scale of [1, 2, 1.03, 1, 1.01, 1, 1.07, 1]) {
    const home = gustZoomHome(scale, armed);
    ({ armed } = home);
    resets += Number(home.reachedHome);
  }
  expect(resets).toBe(1);
  expect(gustZoomHome(1, gustZoomHome(1.5, false).armed).reachedHome).toBe(
    true
  );
});

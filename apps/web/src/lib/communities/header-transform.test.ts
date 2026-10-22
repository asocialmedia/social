import { expect, test } from "bun:test";

import { communityIdentityTransform } from "./header-transform";

test("the original identity starts at its full position, size, and visible width", () => {
  expect(
    communityIdentityTransform(
      {
        sourceWidth: 80,
        sourceX: 16,
        sourceY: 152,
        targetScale: 0.35,
        targetWidth: 28,
        targetX: 60,
        targetY: 284,
      },
      0
    )
  ).toEqual({ clipRight: 0, scale: 1, x: 0, y: 0 });
});

test("the same avatar lands precisely in the sticky bar on phone and desktop", () => {
  for (const { headerHeight, sourceSize, sourceY, targetX } of [
    { headerHeight: 228, sourceSize: 64, sourceY: 112, targetX: 60 },
    { headerHeight: 286, sourceSize: 80, sourceY: 152, targetX: 12 },
  ]) {
    const transform = communityIdentityTransform(
      {
        sourceWidth: sourceSize,
        sourceX: 16,
        sourceY,
        targetScale: 28 / sourceSize,
        targetWidth: 28,
        targetX,
        targetY: headerHeight + 10,
      },
      1
    );
    expect(sourceY + transform.y - headerHeight).toBeCloseTo(10);
    expect(16 + transform.x).toBeCloseTo(targetX);
    expect(sourceSize * transform.scale).toBeCloseTo(28);
  }
});

test("long names stay within their allocated compact slot after scaling", () => {
  const transform = communityIdentityTransform(
    {
      sourceWidth: 600,
      sourceX: 16,
      sourceY: 240,
      targetScale: 14 / 24,
      targetWidth: 90,
      targetX: 48,
      targetY: 302,
    },
    1
  );
  expect((600 - transform.clipRight) * transform.scale).toBeCloseTo(90);
});

test("overscroll and spring overshoot clamp to the endpoints and reversing restores the source", () => {
  const geometry = {
    sourceWidth: 64,
    sourceX: 16,
    sourceY: 112,
    targetScale: 28 / 64,
    targetWidth: 28,
    targetX: 60,
    targetY: 238,
  };
  const forward = communityIdentityTransform(geometry, 0.4);
  communityIdentityTransform(geometry, 1);
  expect(communityIdentityTransform(geometry, 0.4)).toEqual(forward);
  expect(communityIdentityTransform(geometry, -0.2)).toEqual(
    communityIdentityTransform(geometry, 0)
  );
  expect(communityIdentityTransform(geometry, 1.2)).toEqual(
    communityIdentityTransform(geometry, 1)
  );
});

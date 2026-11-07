import { describe, expect, test } from "bun:test";

import {
  communityHeaderFrame,
  communityHeaderProgress,
  communityIdentityTransform,
} from "./community-header-identity";

describe("community header collapse math", () => {
  test("switching layout preserves feed position even when an animation reverses midway", () => {
    for (const height of [228, 286]) {
      for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
        const expanded = communityHeaderFrame(height, progress, 0);
        const compact = communityHeaderFrame(height, progress, 1);
        expect(expanded.spacerHeight + expanded.feedY).toBeCloseTo(
          compact.spacerHeight + compact.feedY
        );
        expect(compact.spacerHeight).toBe(48);
      }
      const settled = communityHeaderFrame(height, 1, 1);
      expect(settled.layerY + height).toBe(0);
      expect(settled.feedY).toBe(0);
    }
  });

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

  test("scroll progress tracks the collapse distance and clamps at the endpoints", () => {
    expect(communityHeaderProgress(0, 200)).toBe(0);
    expect(communityHeaderProgress(100, 200)).toBe(0.5);
    expect(communityHeaderProgress(200, 200)).toBe(1);
    expect(communityHeaderProgress(-40, 200)).toBe(0);
    expect(communityHeaderProgress(400, 200)).toBe(1);
    // A zero or negative distance (header not measured yet) never divides by
    // zero: any positive scroll reads as fully collapsed.
    expect(communityHeaderProgress(0, 0)).toBe(0);
    expect(communityHeaderProgress(10, 0)).toBe(1);
    expect(communityHeaderProgress(10, -50)).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";

import {
  AVATAR_CENTER,
  computeEddieRailGeometry,
  RAIL_LEFT,
  RAIL_STROKE,
  RAIL_X,
  REPLY_INDENT,
} from "./eddie-rail";

describe("computeEddieRailGeometry", () => {
  test("stops vertical run at curve start for last sibling", () => {
    const geometry = computeEddieRailGeometry(AVATAR_CENTER, true);
    // Vertical run must stop where curve begins (30 - 16 = 14), not extend to avatarCenter (30)
    expect(geometry.verticalHeight).toBe(14);
    expect(geometry.runHeight).toBe(14);
    // The curve's starting y-coordinate matches the end of the vertical line
    const curveStartY = geometry.curveTop + geometry.railStroke / 2;
    expect(curveStartY).toBe(geometry.runHeight);
  });

  test("runs through to bottom for non-last sibling", () => {
    const geometry = computeEddieRailGeometry(AVATAR_CENTER, false);
    // null signifies bottom: 0 in Yoga style
    expect(geometry.verticalHeight).toBeNull();
    expect(geometry.runHeight).toBe(14);
  });

  test("aligns rail horizontally with the stub channel", () => {
    const geometry = computeEddieRailGeometry(AVATAR_CENTER, true);
    expect(geometry.railLeft).toBe(RAIL_LEFT);
    expect(geometry.railStroke).toBe(RAIL_STROKE);
    expect(geometry.railLeft + geometry.railStroke / 2).toBe(RAIL_X);
  });

  test("curves into the reply avatar at REPLY_INDENT with overlap tail", () => {
    const geometry = computeEddieRailGeometry(AVATAR_CENTER, true);
    // The tail tucks 2px under the avatar at REPLY_INDENT = 32
    expect(geometry.tailLeft).toBe(REPLY_INDENT - RAIL_STROKE);
    expect(geometry.tailWidth).toBe(RAIL_STROKE * 2);
    // Tail extends from 30 to 34, spanning the avatar edge at 32
    expect(geometry.tailLeft + geometry.tailWidth).toBe(
      REPLY_INDENT + RAIL_STROKE
    );
    // Tail centers vertically on avatarCenter
    expect(geometry.tailTop + geometry.railStroke / 2).toBe(AVATAR_CENTER);
  });

  test("clamps runHeight to zero when avatar sits higher than curve radius", () => {
    const geometry = computeEddieRailGeometry(10, true);
    expect(geometry.runHeight).toBe(0);
    expect(geometry.verticalHeight).toBe(0);
  });
});

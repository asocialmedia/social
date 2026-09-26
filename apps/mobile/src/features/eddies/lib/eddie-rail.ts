// Geometry definitions and connector calculations for the Eddie thread tree rail.
// Matches web's comment tree geometry (LEVEL_PAD = 32, RAIL_X = 16, CURVE_RADIUS = 16)
// while adapting to React Native Yoga constraints:
// - AVATAR_CENTER is 30px (40px squircle avatar with 10px row paddingTop)
// - RAIL_X is 16px (centered in the 32px indent channel)
// - RAIL_STROKE is 2px, so RAIL_LEFT sits at 15px (RAIL_X - RAIL_STROKE / 2)
// - The turn arc starts at avatarCenter - CURVE_RADIUS and curves into the avatar at REPLY_INDENT
// - For the last sibling in a branch (isLast: true), the vertical run stops at
//   avatarCenter - CURVE_RADIUS rather than continuing down, preventing an awkward
//   overlapping vertical spike next to the curve.

export const AVATAR_CENTER = 30;
export const RAIL_X = 16;
export const REPLY_INDENT = 32;
export const RAIL_STROKE = 2;
export const RAIL_LEFT = RAIL_X - RAIL_STROKE / 2;
export const CURVE_RADIUS = 16;
export const CURVE_BOX = CURVE_RADIUS + RAIL_STROKE;

export interface EddieRailGeometry {
  curveBox: number;
  curveRadius: number;
  curveTop: number;
  railLeft: number;
  railStroke: number;
  runHeight: number;
  tailLeft: number;
  tailTop: number;
  tailWidth: number;
  verticalHeight: number | null;
}

export function computeEddieRailGeometry(
  avatarCenter: number,
  isLast: boolean
): EddieRailGeometry {
  const runHeight = Math.max(0, avatarCenter - CURVE_RADIUS);
  return {
    curveBox: CURVE_BOX,
    curveRadius: CURVE_RADIUS,
    curveTop: avatarCenter - CURVE_RADIUS - RAIL_STROKE / 2,
    railLeft: RAIL_LEFT,
    railStroke: RAIL_STROKE,
    runHeight,
    tailLeft: REPLY_INDENT - RAIL_STROKE,
    tailTop: avatarCenter - RAIL_STROKE / 2,
    tailWidth: RAIL_STROKE * 2,
    verticalHeight: isLast ? runHeight : null,
  };
}

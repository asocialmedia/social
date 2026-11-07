// 1:1 port of web's lib/communities/header-transform.ts: the pure math
// behind the community header's scroll collapse. The hook shell
// (use-community-header-identity.ts, motion values, DOM measuring) is
// web-only; the frame and identity transforms are platform-free, so they
// live here for the native detail screen to drive with a Reanimated shared
// value instead of a motion value.
//
// The "worklet" directives are no-ops for bun tests but let the UI runtime
// run these functions inside useAnimatedStyle/useDerivedValue without a
// JS-thread round trip.
export interface HeaderIdentityGeometry {
  sourceWidth: number;
  sourceX: number;
  sourceY: number;
  targetScale: number;
  targetWidth: number;
  targetX: number;
  targetY: number;
}

export function communityHeaderFrame(
  height: number,
  progress: number,
  compact: number
) {
  "worklet";
  const amount = Math.max(0, Math.min(1, progress));
  return {
    feedY: height * (compact - amount),
    layerY: -height * amount,
    spacerHeight: 48 + height * (1 - compact),
  };
}

export function communityIdentityTransform(
  geometry: HeaderIdentityGeometry,
  progress: number
) {
  "worklet";
  const amount = Math.max(0, Math.min(1, progress));
  const scale = 1 + (geometry.targetScale - 1) * amount;
  const targetVisibleWidth = geometry.targetWidth / scale;
  return {
    clipRight: Math.max(0, geometry.sourceWidth - targetVisibleWidth) * amount,
    scale,
    x: (geometry.targetX - geometry.sourceX) * amount,
    y: (geometry.targetY - geometry.sourceY) * amount,
  };
}

// Native scroll progress for the morph: web snaps its motion value to the 0/1
// endpoints when the scroll passes the threshold; natively the header is
// in-flow (no absolute layer to snap), so progress tracks the scroll offset
// continuously over the collapse distance (header content above the section
// bar minus the 48px compact bar) and clamps at the endpoints.
export function communityHeaderProgress(
  scrollY: number,
  collapseDistance: number
) {
  "worklet";
  const distance = Math.max(1, collapseDistance);
  const progress = scrollY / distance;
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 1) {
    return 1;
  }
  return progress;
}

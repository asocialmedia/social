export interface HeaderIdentityGeometry {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetScale: number;
}

export function communityIdentityTransform(
  geometry: HeaderIdentityGeometry,
  progress: number
) {
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

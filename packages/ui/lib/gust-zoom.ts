export interface GustZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export const GUST_ZOOM_HOME = 1.02;
export const GUST_ZOOM_REARM = 1.08;

export function gustZoomHome(scale: number, armed: boolean) {
  "worklet";
  return {
    armed: scale > GUST_ZOOM_REARM || (armed && scale !== 1),
    reachedHome: armed && scale === 1,
  };
}

export function gustZoomScale(scale: number): number {
  "worklet";
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(4, Math.max(1, scale));
}

// Preserve the media point under the fingers, then constrain it to the viewport.
export function gustZoomTransform({
  anchorX,
  anchorY,
  focalX,
  focalY,
  mediaHeight,
  mediaWidth,
  scale: requestedScale,
  viewportHeight,
  viewportWidth,
}: {
  anchorX: number;
  anchorY: number;
  focalX: number;
  focalY: number;
  mediaHeight: number;
  mediaWidth: number;
  scale: number;
  viewportHeight: number;
  viewportWidth: number;
}): GustZoomTransform {
  "worklet";
  const clamped = gustZoomScale(requestedScale);
  const scale = clamped <= GUST_ZOOM_HOME ? 1 : clamped;
  const maxX = Math.max(0, (mediaWidth * scale - viewportWidth) / 2);
  const maxY = Math.max(0, (mediaHeight * scale - viewportHeight) / 2);
  return {
    scale,
    x:
      maxX === 0
        ? 0
        : Math.min(
            maxX,
            Math.max(-maxX, focalX - viewportWidth / 2 - anchorX * scale)
          ),
    y:
      maxY === 0
        ? 0
        : Math.min(
            maxY,
            Math.max(-maxY, focalY - viewportHeight / 2 - anchorY * scale)
          ),
  };
}

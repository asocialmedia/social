const CAPTURE_SLOP = 8;
const RESISTANCE = 0.55;

export function pullGestureDecision({
  offset,
  refreshing,
  touches,
  x,
  y,
}: {
  offset: number;
  refreshing: boolean;
  touches: number;
  x: number;
  y: number;
}): "activate" | "fail" | "wait" {
  if (
    refreshing ||
    touches !== 1 ||
    offset > 0 ||
    y < -CAPTURE_SLOP ||
    Math.abs(x) > CAPTURE_SLOP * 2
  ) {
    return "fail";
  }
  return y > CAPTURE_SLOP ? "activate" : "wait";
}

export function pullDistance(translation: number, baseline: number): number {
  return Math.max(0, translation - baseline) * RESISTANCE;
}

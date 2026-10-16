export function seekRatio(position: number, width: number): number {
  "worklet";
  if (!Number.isFinite(position) || !Number.isFinite(width) || width <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, position / width));
}

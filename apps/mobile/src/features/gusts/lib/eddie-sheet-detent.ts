export function eddieSheetDetent(
  position: number,
  velocity: number,
  halfOffset: number
): "full" | "half" | "closed" {
  "worklet";
  const projected = position + velocity * 0.15;
  if (projected > halfOffset * 1.4) {
    return "closed";
  }
  return projected < halfOffset * 0.5 ? "full" : "half";
}

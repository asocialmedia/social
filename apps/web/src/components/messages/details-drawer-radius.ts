// The sheet is square at the viewport top and reaches its normal radius at 60%.
export function detailsDrawerRadius(offset: number, partialOffset: number) {
  if (partialOffset <= 0) {
    return 0;
  }
  return 16 * Math.min(1, Math.max(0, offset / partialOffset));
}

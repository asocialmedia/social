// Match clientWidth's pixel rounding and ignore height-only resize notifications.
export function createDistinctWidthReporter(onWidth: (width: number) => void) {
  let previousWidth: number | undefined;
  return (measuredWidth: number) => {
    const width = Math.round(measuredWidth);
    if (width === previousWidth) {
      return;
    }
    previousWidth = width;
    onWidth(width);
  };
}

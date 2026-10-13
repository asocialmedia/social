export function visibleTabScrollOffset({
  itemLeft,
  itemWidth,
  offset,
  viewportWidth,
  padding = 8,
}: {
  itemLeft: number;
  itemWidth: number;
  offset: number;
  viewportWidth: number;
  padding?: number;
}): number {
  if (viewportWidth <= 0) {
    return offset;
  }
  if (itemLeft < offset + padding) {
    return Math.max(0, itemLeft - padding);
  }
  if (itemLeft + itemWidth > offset + viewportWidth - padding) {
    return Math.max(0, itemLeft + itemWidth - viewportWidth + padding);
  }
  return offset;
}

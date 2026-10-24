export function isRecommendationVisible(
  entry: IntersectionObserverEntry | undefined
): boolean {
  if (!entry?.isIntersecting) {
    return false;
  }
  if (
    !entry.rootBounds ||
    !entry.boundingClientRect ||
    !entry.intersectionRect
  ) {
    return entry.intersectionRatio >= 0.6;
  }
  const visibleHeight = Math.min(
    entry.boundingClientRect.height,
    entry.rootBounds.height
  );
  return (
    visibleHeight > 0 &&
    entry.intersectionRect.width > 0 &&
    entry.intersectionRect.height >= visibleHeight * 0.6
  );
}

export function swipeTab<T extends string>(
  tabs: readonly T[],
  current: T,
  direction: -1 | 1
): T {
  const index = tabs.indexOf(current);
  return (
    tabs[Math.max(0, Math.min(tabs.length - 1, index + direction))] ?? current
  );
}

export function bottomDockPadding({
  bottomInset,
  dockHeight,
  guestBarHeight = 0,
}: {
  bottomInset: number;
  dockHeight: number;
  guestBarHeight?: number;
}): number {
  return bottomInset + dockHeight + 36 + guestBarHeight;
}

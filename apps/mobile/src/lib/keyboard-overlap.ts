// Both coordinates are measured in screen space, including the viewport origin.
export function keyboardOverlap(
  viewportBottom: number,
  keyboardTop: number | null
): number {
  return keyboardTop === null ? 0 : Math.max(0, viewportBottom - keyboardTop);
}

export function keyboardScreenTop({
  bottomInset,
  height,
  platform,
  screenHeight,
  screenY,
}: {
  bottomInset: number;
  height: number;
  platform: string;
  screenHeight: number;
  screenY: number;
}): number {
  // RN's Android adjustResize event can report the unresized window bottom.
  // IME height excludes the navigation inset, so put that inset back once.
  if (platform === "android" && height > 0) {
    return Math.min(screenY, screenHeight - height - bottomInset);
  }
  return screenY;
}

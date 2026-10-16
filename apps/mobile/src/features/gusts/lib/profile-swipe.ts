export const PROFILE_SWIPE_SLOP = 18;

export function opensGustProfile({
  translationX,
  translationY,
  velocityX,
  viewportWidth,
}: {
  translationX: number;
  translationY: number;
  velocityX: number;
  viewportWidth: number;
}): boolean {
  "worklet";
  const distance = -translationX;
  if (distance < 32 || Math.abs(translationY) > distance * 0.45) {
    return false;
  }
  // A deliberate drag or a short leftward flick opens the author, never a vertical page turn.
  return distance >= Math.max(64, viewportWidth * 0.2) || velocityX <= -700;
}

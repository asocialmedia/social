export const EDDIE_MUTE_CLEARANCE = 56;

export function eddieSheetMuteOpacity(
  position: number,
  viewportHeight: number,
  topInset: number
): number {
  "worklet";
  // The control lives 56 dp above the panel; hide it before either screen edge catches it.
  return Math.max(
    0,
    Math.min(
      1,
      position / EDDIE_MUTE_CLEARANCE,
      (viewportHeight - topInset - position) / EDDIE_MUTE_CLEARANCE
    )
  );
}

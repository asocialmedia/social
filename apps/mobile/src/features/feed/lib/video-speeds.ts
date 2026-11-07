// Playback speed steps and tap-zone math for the media viewer video player,
// ported from web's custom-video-player.tsx PLAYBACK_SPEEDS and the
// double-tap ±10s zones. Pure and unit-testable on Node.

// Web's 8-step settings menu, in order. The native viewer cycles these on the
// speed chip (no room for a settings menu at phone size); the gust card keeps
// its own 1x/2x boost, which is a different surface.
export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function nextPlaybackSpeed(current: number): number {
  const index = PLAYBACK_SPEEDS.indexOf(current);
  // An unknown rate (e.g. set by the OS) restarts the cycle at 1x rather than
  // jumping to the slowest step.
  if (index === -1) {
    return 1;
  }
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length] ?? 1;
}

// Double-tap zones: the left half seeks back, the right half seeks forward,
// matching web's half-screen double-click zones.
export const DOUBLE_TAP_SEEK_SECONDS = 10;

export function doubleTapDirection(
  locationX: number,
  width: number
): "backward" | "forward" {
  return locationX < width / 2 ? "backward" : "forward";
}

export function clampSeekTarget(
  currentTime: number,
  deltaSeconds: number,
  duration: number | null
): number {
  const target = currentTime + deltaSeconds;
  if (duration !== null && Number.isFinite(duration) && duration >= 0) {
    return Math.min(Math.max(target, 0), duration);
  }
  return Math.max(target, 0);
}

export interface VideoClockState<Player> {
  duration: number;
  player: Player;
  seconds: number;
}

export function updateVideoClockTime<Player>(
  current: VideoClockState<Player>,
  player: Player,
  currentTime: number
): VideoClockState<Player> {
  if (current.player !== player || !Number.isFinite(currentTime)) {
    return current;
  }
  const seconds = Math.max(0, Math.floor(currentTime));
  return seconds === current.seconds ? current : { ...current, seconds };
}

export function updateVideoClockDuration<Player>(
  current: VideoClockState<Player>,
  player: Player,
  duration: number
): VideoClockState<Player> {
  return current.player !== player ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    current.duration === duration
    ? current
    : { ...current, duration };
}

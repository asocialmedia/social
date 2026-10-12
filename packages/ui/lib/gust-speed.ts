export const GUST_SPEED_HOLD_MS = 450;
export const GUST_SPEED_HOLD_SLOP = 12;
export const GUST_SPEED_BOOST = 2;

// A stationary hold boosts playback; releasing or another gesture consumes the tap.
export function createGustSpeedHold({
  onChange,
  onConsumeTap,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
}: {
  onChange: (active: boolean) => void;
  onConsumeTap: () => void;
  schedule?: typeof setTimeout;
  cancelSchedule?: typeof clearTimeout;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;
  let active = false;
  const cancel = () => {
    if (timer !== null) {
      cancelSchedule(timer);
      timer = null;
    }
    origin = null;
    if (active) {
      active = false;
      onChange(false);
      onConsumeTap();
    }
  };
  return {
    cancel,
    move(x: number, y: number) {
      if (
        origin &&
        Math.hypot(x - origin.x, y - origin.y) > GUST_SPEED_HOLD_SLOP
      ) {
        cancel();
      }
    },
    start(x: number, y: number) {
      cancel();
      origin = { x, y };
      timer = schedule(() => {
        timer = null;
        active = true;
        onConsumeTap();
        onChange(true);
      }, GUST_SPEED_HOLD_MS);
    },
  };
}

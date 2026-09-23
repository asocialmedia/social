// Audio waveform + equalizer math for the feed's audio row, ported from web's
// posts/editor/waveform (EQ_BAR_COUNT, EQ_FALLBACK_HEIGHTS, extractWaveform)
// and the asm-eq keyframes in globals.css. Pure so it is unit-testable.
//
// Web decodes the audio file with Web Audio to build its bars. Native has no
// decoder, so it reads the pipeline's wave-peaks.json derivative instead
// (200 max-amplitude buckets) and reshapes it into the same 80-bar profile.

export const EQ_BAR_COUNT = 80;

// Deterministic profile shown until the real waveform arrives (0..1
// fractions; bars render `height * 100%`).
export const EQ_FALLBACK_HEIGHTS: number[] = Array.from(
  { length: EQ_BAR_COUNT },
  (_, index) => (30 + ((index * 37) % 55)) / 100
);

export interface WavePeaks {
  durationMs: number | null;
  peaks: number[];
}

export function parseWavePeaks(payload: unknown): WavePeaks | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const { durationMs, peaks } = payload as {
    durationMs?: unknown;
    peaks?: unknown;
  };
  if (!Array.isArray(peaks)) {
    return null;
  }
  const clean = peaks.map((value) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(1, Math.abs(value))
      : 0
  );
  if (clean.length === 0) {
    return null;
  }
  return {
    durationMs:
      typeof durationMs === "number" &&
      Number.isFinite(durationMs) &&
      durationMs > 0
        ? durationMs
        : null,
    peaks: clean,
  };
}

// Buckets the peaks into barCount bars, then applies web extractWaveform's
// shaping: normalize against the loudest bar, sqrt so quiet passages still
// read, floor 0.12 so silence never collapses, cap 0.85 so the playing
// bounce (scaleY 1.15) never overflows the row.
export function shapeWaveform(
  peaks: readonly number[],
  barCount = EQ_BAR_COUNT
): number[] {
  if (peaks.length === 0 || barCount <= 0) {
    return [];
  }
  const bars: number[] = [];
  for (let bar = 0; bar < barCount; bar += 1) {
    const start = Math.floor((bar * peaks.length) / barCount);
    const end = Math.max(
      start + 1,
      Math.floor(((bar + 1) * peaks.length) / barCount)
    );
    let peak = 0;
    for (let index = start; index < end && index < peaks.length; index += 1) {
      peak = Math.max(peak, peaks[index] ?? 0);
    }
    bars.push(peak);
  }
  const loudest = Math.max(...bars, 1e-6);
  return bars.map((value) => {
    const shaped = Math.sqrt(value / loudest);
    return Math.max(0.12, Math.min(0.85, shaped * 0.75 + 0.1));
  });
}

// asm-eq: scaleY 0.4 -> 1.15 -> 0.4 over 0.8s, ease-in-out per half.
export const EQ_PERIOD_MS = 800;
export const EQ_MIN_SCALE = 0.4;
export const EQ_MAX_SCALE = 1.15;
// animation-delay: -index * 0.04s, i.e. each bar runs 0.05 of a period ahead
// of the previous one.
export const EQ_BAR_PHASE_STEP = 0.04 / 0.8;

// One axis of a cubic bezier anchored at 0 and 1, and its derivative.
function bezierAxis(t: number, p1: number, p2: number): number {
  return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
}

function bezierSlope(t: number, p1: number, p2: number): number {
  return (
    3 * (1 - t) * (1 - t) * p1 +
    6 * (1 - t) * t * (p2 - p1) +
    3 * t * t * (1 - p2)
  );
}

// CSS `ease-in-out` is cubic-bezier(0.42, 0, 0.58, 1). Solved for y at x
// with a few Newton steps (the curve is monotonic, so this converges fast).
export function cssEaseInOut(progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  let t = x;
  for (let step = 0; step < 6; step += 1) {
    const error = bezierAxis(t, 0.42, 0.58) - x;
    const derivative = bezierSlope(t, 0.42, 0.58);
    if (Math.abs(error) < 1e-5 || derivative === 0) {
      break;
    }
    t = Math.min(1, Math.max(0, t - error / derivative));
  }
  return bezierAxis(t, 0, 1);
}

// Keyframe value at a point in the cycle (0..1).
export function eqScaleAt(cycle: number): number {
  const wrapped = ((cycle % 1) + 1) % 1;
  const half = wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2;
  return EQ_MIN_SCALE + (EQ_MAX_SCALE - EQ_MIN_SCALE) * cssEaseInOut(half);
}

// Interpolation table for one bar: a single 0..1 looping driver maps through
// these points to that bar's phase-shifted keyframe curve, so one native
// animation runs every bar exactly like the per-bar CSS animations.
export function eqBarInterpolation(
  index: number,
  samples = 24
): { inputRange: number[]; outputRange: number[] } {
  const offset = index * EQ_BAR_PHASE_STEP;
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let sample = 0; sample <= samples; sample += 1) {
    const input = sample / samples;
    inputRange.push(input);
    outputRange.push(Number(eqScaleAt(input + offset).toFixed(4)));
  }
  return { inputRange, outputRange };
}

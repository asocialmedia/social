import { describe, expect, test } from "bun:test";

import {
  EQ_BAR_COUNT,
  EQ_FALLBACK_HEIGHTS,
  EQ_MAX_SCALE,
  EQ_MIN_SCALE,
  cssEaseInOut,
  eqBarInterpolation,
  eqScaleAt,
  parseWavePeaks,
  shapeWaveform,
} from "./waveform";

describe("EQ_FALLBACK_HEIGHTS", () => {
  test("matches web's deterministic 80-bar profile", () => {
    expect(EQ_FALLBACK_HEIGHTS).toHaveLength(EQ_BAR_COUNT);
    expect(EQ_FALLBACK_HEIGHTS[0]).toBe(0.3);
    expect(EQ_FALLBACK_HEIGHTS[1]).toBe(0.67);
  });
});

describe("parseWavePeaks", () => {
  test("reads the pipeline payload", () => {
    expect(parseWavePeaks({ durationMs: 1500, peaks: [0.1, 0.5] })).toEqual({
      durationMs: 1500,
      peaks: [0.1, 0.5],
    });
  });

  test("clamps junk values and drops a bad duration", () => {
    expect(parseWavePeaks({ durationMs: -1, peaks: [2, "x", -0.5] })).toEqual({
      durationMs: null,
      peaks: [1, 0, 0.5],
    });
  });

  test("rejects payloads without peaks", () => {
    expect(parseWavePeaks(null)).toBeNull();
    expect(parseWavePeaks({ peaks: [] })).toBeNull();
    expect(parseWavePeaks({ peaks: "nope" })).toBeNull();
  });
});

describe("shapeWaveform", () => {
  test("buckets peaks into the requested bar count", () => {
    const peaks = Array.from({ length: 200 }, (_, index) => index / 200);
    expect(shapeWaveform(peaks)).toHaveLength(EQ_BAR_COUNT);
  });

  test("normalizes to the loudest bar and applies web's floor and cap", () => {
    const bars = shapeWaveform([0, 0.25, 1], 3);
    expect(bars[0]).toBe(0.12);
    expect(bars[1]).toBeCloseTo(0.475, 5);
    expect(bars[2]).toBe(0.85);
  });

  test("stays at the floor for silence", () => {
    expect(shapeWaveform([0, 0, 0, 0], 2)).toEqual([0.12, 0.12]);
  });

  test("spreads fewer peaks than bars without gaps", () => {
    expect(shapeWaveform([1, 0.5], 4)).toHaveLength(4);
  });
});

describe("equalizer keyframes", () => {
  test("css ease-in-out keeps its endpoints and midpoint", () => {
    expect(cssEaseInOut(0)).toBe(0);
    expect(cssEaseInOut(1)).toBe(1);
    expect(cssEaseInOut(0.5)).toBeCloseTo(0.5, 4);
    expect(cssEaseInOut(0.25)).toBeLessThan(0.25);
  });

  test("bounces 0.4 -> 1.15 -> 0.4 over one cycle", () => {
    expect(eqScaleAt(0)).toBeCloseTo(EQ_MIN_SCALE, 5);
    expect(eqScaleAt(0.5)).toBeCloseTo(EQ_MAX_SCALE, 5);
    expect(eqScaleAt(1)).toBeCloseTo(EQ_MIN_SCALE, 5);
  });

  test("each bar runs a twentieth of a cycle ahead of the last", () => {
    const first = eqBarInterpolation(0, 20);
    const second = eqBarInterpolation(1, 20);
    expect(first.inputRange).toHaveLength(21);
    expect(second.outputRange[0]).toBeCloseTo(first.outputRange[1] ?? 0, 4);
  });
});

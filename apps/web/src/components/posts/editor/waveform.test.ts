import { describe, expect, test } from "bun:test";

import { EQ_BAR_COUNT, EQ_FALLBACK_HEIGHTS, extractWaveform } from "./waveform";

describe("extractWaveform", () => {
  test("returns exactly barCount bars", () => {
    const channel = new Float32Array(4800).fill(0.5);
    expect(extractWaveform(channel, 48)).toHaveLength(48);
  });

  test("all bars stay within the visualizer bounds", () => {
    const channel = new Float32Array(4800);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = Math.sin(i / 10) * 0.9;
    }
    const waveform = extractWaveform(channel, 48);
    for (const bar of waveform) {
      expect(bar).toBeGreaterThanOrEqual(0.12);
      expect(bar).toBeLessThanOrEqual(0.85);
    }
  });

  test("silence flattens to the quiet floor, never collapses", () => {
    const channel = new Float32Array(4800);
    const waveform = extractWaveform(channel, 48);
    for (const bar of waveform) {
      expect(bar).toBe(0.12);
    }
  });

  test("loud constant tone is capped near the top, not over the edge", () => {
    const channel = new Float32Array(4800).fill(1);
    const waveform = extractWaveform(channel, 48);
    for (const bar of waveform) {
      expect(bar).toBe(0.85);
    }
  });

  test("a loud half followed by a quiet half keeps a real shape", () => {
    const channel = new Float32Array(4800);
    for (let i = 0; i < 2400; i += 1) {
      channel[i] = 0.9;
    }
    for (let i = 2400; i < 4800; i += 1) {
      channel[i] = 0.05;
    }
    const waveform = extractWaveform(channel, 48);
    const loudBars = waveform.slice(0, 24);
    const quietBars = waveform.slice(24);
    const loudAvg = loudBars.reduce((a, b) => a + b, 0) / loudBars.length;
    const quietAvg = quietBars.reduce((a, b) => a + b, 0) / quietBars.length;
    expect(loudAvg).toBeGreaterThan(quietAvg);
    // The quiet half must stay visible, not vanish to the floor.
    expect(quietAvg).toBeGreaterThan(0.12);
  });

  test("a mastered-style track (near-fullscale everywhere) is normalized, not a wall", () => {
    const channel = new Float32Array(4800);
    for (let i = 0; i < channel.length; i += 1) {
      // Loud music with dynamics: chorus peaks higher than verse.
      const verse = i < 2400;
      channel[i] = verse ? Math.sin(i / 20) * 0.7 : Math.sin(i / 20) * 0.98;
    }
    const waveform = extractWaveform(channel, 48);
    const verseBars = waveform.slice(0, 24);
    const chorusBars = waveform.slice(24);
    const verseAvg = verseBars.reduce((a, b) => a + b, 0) / verseBars.length;
    const chorusAvg = chorusBars.reduce((a, b) => a + b, 0) / chorusBars.length;
    expect(chorusAvg).toBeGreaterThan(verseAvg);
    // Not every bar pinned to the cap.
    expect(verseAvg).toBeLessThan(0.85);
  });

  test("channels shorter than one bar per sample still yield barCount bars", () => {
    const channel = new Float32Array(10).fill(0.5);
    const waveform = extractWaveform(channel, 48);
    expect(waveform).toHaveLength(48);
  });
});

describe("EQ_FALLBACK_HEIGHTS", () => {
  test("matches the visualizer bar count", () => {
    expect(EQ_FALLBACK_HEIGHTS).toHaveLength(EQ_BAR_COUNT);
  });

  test("holds fractions (0..1), not raw percentages", () => {
    for (const height of EQ_FALLBACK_HEIGHTS) {
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThanOrEqual(1);
    }
  });

  test("is varied so the loading state never reads as a flat wall", () => {
    const unique = new Set(EQ_FALLBACK_HEIGHTS);
    expect(unique.size).toBeGreaterThan(10);
  });
});

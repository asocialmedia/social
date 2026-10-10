import { describe, expect, test } from "bun:test";

import {
  auraParticles,
  isRapidGustTap,
  nextAuraBurstTiming,
} from "@asm/ui/lib/aura-burst";

describe("rapid Gust amplification feedback", () => {
  test("rapid streaks linger progressively longer, stay bounded and reset after a pause", () => {
    let timing = nextAuraBurstTiming(1000, null);
    expect(timing.durationMs).toBe(1200);
    timing = nextAuraBurstTiming(1100, timing);
    expect(timing.durationMs).toBe(1425);
    for (let at = 1200; at < 10_000; at += 100) {
      timing = nextAuraBurstTiming(at, timing);
    }
    expect(timing.durationMs).toBe(2100);
    expect(timing.streak).toBe(5);
    expect(nextAuraBurstTiming(timing.at + 280, timing).durationMs).toBe(1200);
    expect(nextAuraBurstTiming(900, timing).streak).toBe(1);
  });
  test("every tap after the second keeps the burst chain alive without scheduling playback", () => {
    let previous: number | null = null;
    const chain = [1000, 1100, 1180, 1250, 1350].map((time) => {
      const rapid = isRapidGustTap(time, previous);
      previous = time;
      return rapid;
    });
    expect(chain).toEqual([false, true, true, true, true]);
    expect(isRapidGustTap(1630, previous)).toBe(false);
    expect(isRapidGustTap(900, previous)).toBe(false);
  });

  test("bounded bursts vary shades and paths while remaining deterministic", () => {
    const bursts = Array.from({ length: 14 }, (_, id) => auraParticles(id));
    expect(auraParticles(4)).toEqual(auraParticles(4));
    expect(new Set(bursts.flat().map((particle) => particle.fill)).size).toBe(
      6
    );
    for (const burst of bursts) {
      expect(burst).toHaveLength(3);
      expect(burst[1]?.drift).toBeLessThan(0);
      expect(burst[2]?.drift).toBeGreaterThan(0);
      for (const particle of burst) {
        expect(particle.opacity).toBeGreaterThanOrEqual(0.55);
        expect(particle.opacity).toBeLessThanOrEqual(1);
        expect(particle.size).toBeLessThanOrEqual(54);
      }
    }
  });
});

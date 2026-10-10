// Shared deterministic palettes keep native and web bursts varied without random work per frame.
const PALETTE = [
  { edge: "#ffbe62", fill: "#ff6b21", light: "#ffe8a1" },
  { edge: "#ffd889", fill: "#ff9500", light: "#fff2bd" },
  { edge: "#ffac8b", fill: "#f74f44", light: "#ffcf78" },
  { edge: "#ffe3a5", fill: "#ffb51b", light: "#fff6cf" },
  { edge: "#ffc894", fill: "#ff7c52", light: "#ffe9a7" },
  { edge: "#ffd06e", fill: "#f96a08", light: "#fff0ad" },
] as const;

export function auraParticles(burstId: number) {
  return [0, 1, 2].map((index) => {
    const variation = Math.abs(burstId * 7 + index * 11);
    const palette = PALETTE[variation % PALETTE.length] ?? PALETTE[0];
    return {
      ...palette,
      drift:
        index === 0
          ? (variation % 25) - 12
          : (index === 1 ? -1 : 1) * (28 + (variation % 26)),
      lift: 80 + (variation % 55),
      opacity: index === 0 ? 1 : 0.55 + (variation % 4) * 0.1,
      rotation: (variation % 41) - 20,
      size: index === 0 ? 46 + (variation % 9) : 20 + (variation % 11),
    };
  });
}

export function isRapidGustTap(now: number, previous: number | null) {
  return previous !== null && now >= previous && now - previous < 280;
}

export interface AuraBurstTiming {
  at: number;
  durationMs: number;
  streak: number;
}

export function nextAuraBurstTiming(
  at: number,
  previous: AuraBurstTiming | null
): AuraBurstTiming {
  const streak = isRapidGustTap(at, previous?.at ?? null)
    ? Math.min(5, (previous?.streak ?? 0) + 1)
    : 1;
  return { at, durationMs: 1200 + (streak - 1) * 225, streak };
}

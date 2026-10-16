// Shared deterministic palettes keep native and web bursts varied without random work per frame.
const PALETTE = [
  { edge: "#ff9500", fill: "#ff6b21" },
  { edge: "#ff8800", fill: "#ff7500" },
  { edge: "#ff7b00", fill: "#ff8000" },
  { edge: "#ff9a00", fill: "#ff7000" },
  { edge: "#ff8500", fill: "#ff7200" },
  { edge: "#ff9000", fill: "#ff6800" },
] as const;

export function auraParticles(burstId: number) {
  const variation = Math.abs(burstId * 7);
  const palette = PALETTE[variation % PALETTE.length] ?? PALETTE[0];
  return [
    {
      ...palette,
      drift: 15 + (variation % 20),
      lift: 100 + (variation % 40),
      opacity: 0.8 + (variation % 3) * 0.05,
      rotation: 15 + (variation % 15),
      size: 40 + (variation % 15),
    },
  ];
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

// Community accent colour resolution for light and dark themes.
// Mirrors @asm/db/communities palette so React Native does not attempt to use
// named tokens (like "stone" or "pine") directly as CSS color values.

export const COMMUNITY_ACCENTS_PALETTE = {
  clay: { dark: "#fbbf24", label: "Clay", light: "#b45309" },
  denim: { dark: "#60a5fa", label: "Denim", light: "#1d4ed8" },
  ember: { dark: "#fb923c", label: "Ember", light: "#c2410c" },
  iris: { dark: "#818cf8", label: "Iris", light: "#4338ca" },
  moss: { dark: "#a3e635", label: "Moss", light: "#4d7c0f" },
  ocean: { dark: "#2dd4bf", label: "Ocean", light: "#0f766e" },
  pine: { dark: "#34d399", label: "Pine", light: "#047857" },
  plum: { dark: "#c084fc", label: "Plum", light: "#7e22ce" },
  rose: { dark: "#f472b6", label: "Rose", light: "#be185d" },
  sand: { dark: "#fde047", label: "Sand", light: "#a16207" },
  slate: { dark: "#94a3b8", label: "Slate", light: "#334155" },
  stone: { dark: "#a8a29e", label: "Stone", light: "#57534e" },
} as const;

export type CommunityAccentKey = keyof typeof COMMUNITY_ACCENTS_PALETTE;

export const DEFAULT_COMMUNITY_ACCENT: CommunityAccentKey = "slate";

export function resolveCommunityAccentColor(
  accentKey: string | null | undefined,
  isDark: boolean
): string {
  if (!accentKey) {
    const fallback = COMMUNITY_ACCENTS_PALETTE[DEFAULT_COMMUNITY_ACCENT];
    return isDark ? fallback.dark : fallback.light;
  }
  if (accentKey.startsWith("#") || accentKey.startsWith("rgb")) {
    return accentKey;
  }
  const key = accentKey.toLowerCase() as CommunityAccentKey;
  const palette = COMMUNITY_ACCENTS_PALETTE[key];
  if (palette) {
    return isDark ? palette.dark : palette.light;
  }
  const fallback = COMMUNITY_ACCENTS_PALETTE[DEFAULT_COMMUNITY_ACCENT];
  return isDark ? fallback.dark : fallback.light;
}

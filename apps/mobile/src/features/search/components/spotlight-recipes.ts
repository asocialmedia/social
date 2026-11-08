// The Spotlight's 3D recipes and theme tokens, transcribed from
// packages/ui/styles/globals.css (`.segmented-3d`, `.segment-3d*`,
// `.chip-3d*`, `.surface-3d-on-brand`, `.bluesky-3d-surface`) and the HSL
// custom properties web's Spotlight reads. The Bluesky set mirrors the
// `blueskyTheme` override web scopes onto the dialog when the network is
// Bluesky, where every muted token turns white.
import { themeText } from "@/components/surface/recipes";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK } from "@/theme";

export interface GradientRecipe {
  colors: readonly [string, string];
  shadows: string;
}

export interface SpotlightPalette {
  blue: boolean;
  // `border-border/60`, the hairline over the results list.
  divider: string;
  foreground: string;
  // `text-muted-foreground`.
  muted: string;
  // A pressed row, web's hovered `bg-accent/70` (`bg-white/15` on Bluesky).
  rowPressed: string;
  // `bg-muted` skeleton blocks.
  skeleton: string;
  // Copy web sets to `text-white/80` on Bluesky and leaves muted otherwise.
  soft: string;
}

export function spotlightPalette(
  isDark: boolean,
  blue: boolean
): SpotlightPalette {
  if (blue) {
    return {
      blue,
      divider: "rgba(255, 255, 255, 0.6)",
      foreground: "#ffffff",
      muted: "#ffffff",
      rowPressed: "rgba(255, 255, 255, 0.15)",
      skeleton: "#0066cc",
      soft: "rgba(255, 255, 255, 0.8)",
    };
  }
  const text = themeText(isDark);
  return {
    blue,
    divider: isDark ? "rgba(61, 61, 61, 0.6)" : "rgba(216, 216, 216, 0.6)",
    foreground: text.foreground,
    muted: text.muted,
    rowPressed: isDark ? "rgba(48, 48, 48, 0.7)" : "rgba(232, 232, 232, 0.7)",
    skeleton: isDark ? "#262626" : "#efefef",
    soft: text.muted,
  };
}

// `.bluesky-3d-surface` (dark) and its `:root:not(.dark)` override.
export function blueskySurface(isDark: boolean): GradientRecipe {
  return {
    colors: ["#159dff", "#0866df"],
    shadows: isDark
      ? "inset 0 0 0 1px rgba(255, 255, 255, 0.28), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px #0758bf, 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 70, 180, 0.2)"
      : "inset 0 0 0 1px rgba(255, 255, 255, 0.5), inset 0 1.5px 2px rgba(255, 255, 255, 0.65), 0 0 0 1px rgba(8, 102, 223, 0.4), 0 1px 2px rgba(0, 70, 180, 0.25), 0 3px 7px -2px rgba(0, 70, 180, 0.3)",
  };
}

// `.segmented-3d` / `.segmented-3d-on-brand`: the recessed track.
export function segmentedTrack(isDark: boolean, blue: boolean): GradientRecipe {
  if (blue) {
    return {
      colors: ["rgba(2, 46, 112, 0.34)", "rgba(2, 46, 112, 0.18)"],
      shadows:
        "inset 0 1px 2px rgba(0, 26, 70, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.32), 0 1px 1px rgba(255, 255, 255, 0.26)",
    };
  }
  return isDark
    ? {
        colors: ["#1d1d1d", "#262626"],
        shadows:
          "inset 0 2px 4px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.06), 0 1px 1px rgba(255, 255, 255, 0.04)",
      }
    : {
        colors: ["#efefef", "#f3f4f6"],
        shadows:
          "inset 0 2px 3px rgba(0, 0, 0, 0.1), inset 0 0 0 1px rgba(0, 0, 0, 0.06), 0 1px 1px rgba(255, 255, 255, 0.7)",
      };
}

export type SegmentSkin = "neutral" | "orange" | "bluesky" | "onBrand";

// `.segment-3d`, `.segment-3d-orange`, `.segment-3d-bluesky` and
// `.segment-3d-on-brand`: a raised key in the track, with its ink.
export function segmentKey(
  isDark: boolean,
  skin: SegmentSkin
): GradientRecipe & { text: string } {
  if (skin === "orange") {
    return {
      colors: ["#ff9500", "#e65500"],
      shadows:
        "inset 0 0 0 1px rgba(255, 255, 255, 0.28), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 2px 4px rgba(0, 0, 0, 0.14)",
      text: "#ffffff",
    };
  }
  if (skin === "bluesky") {
    return {
      colors: ["#159dff", "#0866df"],
      shadows:
        "inset 0 0 0 1px rgba(255, 255, 255, 0.3), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px #0758bf, 0 1px 1px rgba(255, 255, 255, 0.4), 0 2px 4px rgba(0, 70, 180, 0.24)",
      text: "#ffffff",
    };
  }
  if (skin === "onBrand") {
    return {
      colors: ["#ffffff", "#e9f2ff"],
      shadows:
        "inset 0 0 0 1px rgba(255, 255, 255, 1), inset 0 1.5px 2px #ffffff, 0 1px 2px rgba(1, 32, 85, 0.32)",
      text: "#0866df",
    };
  }
  return isDark
    ? {
        colors: ["#3d3d3d", "#2b2b2b"],
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.14), inset 0 1.5px 2px rgba(255, 255, 255, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4)",
        text: "#eeeeee",
      }
    : {
        colors: ["#f9f9f9", "#fcfcfc"],
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.9), inset 0 1.5px 2px rgba(255, 255, 255, 1), 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.12)",
        text: "#202020",
      };
}

// `.chip-3d-raised`: the chosen option in the filter menu.
export function chipRaised(isDark: boolean): GradientRecipe & {
  border: string;
  text: string;
} {
  return isDark
    ? {
        border: "rgba(255, 255, 255, 0.12)",
        colors: ["#3a3a3a", "#2a2a2a"],
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1.5px 2px rgba(255, 255, 255, 0.14), inset 0 -1px 2px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.4)",
        text: "#eeeeee",
      }
    : {
        border: "rgba(0, 0, 0, 0.14)",
        colors: ["#f9f9f9", "#efefef"],
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), inset 0 -1px 2px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.08)",
        text: "#202020",
      };
}

export interface FlatRecipe {
  background: string;
  border: string;
  shadows: string;
}

// `.chip-3d` / `.chip-3d-on-brand`: interest chips and the history icon tile.
export function chipFlat(isDark: boolean, blue: boolean): FlatRecipe {
  if (blue) {
    return {
      background: "rgba(255, 255, 255, 0.16)",
      border: "rgba(255, 255, 255, 0.38)",
      shadows:
        "inset 0 1px 1px rgba(255, 255, 255, 0.34), inset 0 -1px 2px rgba(0, 25, 70, 0.16), 0 1px 2px rgba(0, 30, 80, 0.18)",
    };
  }
  return isDark
    ? {
        background: "#262626",
        border: "rgba(255, 255, 255, 0.1)",
        shadows:
          "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 1px 1px rgba(0, 0, 0, 0.2)",
      }
    : {
        background: "#efefef",
        border: "rgba(0, 0, 0, 0.08)",
        shadows:
          "inset 0 1px 1px rgba(255, 255, 255, 0.7), 0 1px 1px rgba(0, 0, 0, 0.04)",
      };
}

// `.surface-3d` (the Card primitive) and `.surface-3d-on-brand` with the
// `border-white/30` web adds on Bluesky: the suggested account card.
export function cardSurface(isDark: boolean, blue: boolean): FlatRecipe {
  if (blue) {
    return {
      background: "rgba(255, 255, 255, 0.13)",
      border: "rgba(255, 255, 255, 0.3)",
      shadows:
        "inset 0 1px 1px rgba(255, 255, 255, 0.32), inset 0 -1px 2px rgba(0, 25, 70, 0.16), 0 1px 2px rgba(0, 30, 80, 0.18)",
    };
  }
  return {
    background: isDark ? "#171717" : "#f3f4f6",
    border: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
    shadows: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
  };
}

// The tinted washes a suggested card falls back to without a banner, picked
// by the same code-point sum web uses.
const SKY_WASH = [
  "rgba(14, 165, 233, 0.45)",
  "rgba(99, 102, 241, 0.25)",
] as const;
const BANNER_WASHES: readonly (readonly [string, string])[] = [
  SKY_WASH,
  ["rgba(249, 115, 22, 0.45)", "rgba(244, 63, 94, 0.25)"],
  ["rgba(16, 185, 129, 0.4)", "rgba(20, 184, 166, 0.2)"],
  ["rgba(245, 158, 11, 0.45)", "rgba(234, 88, 12, 0.25)"],
];

export function bannerWash(seed: string): readonly [string, string] {
  let sum = 0;
  for (let index = 0; index < seed.length; index += 1) {
    sum += seed.codePointAt(index) ?? 0;
  }
  return BANNER_WASHES[sum % BANNER_WASHES.length] ?? SKY_WASH;
}

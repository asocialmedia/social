import type { ToastState } from "./types";

// Port of the `:root` custom properties in gooey-toast@0.2.2 `dist/styles.css`.
//
// The stylesheet declares the state tones as `oklch(...)`, which neither Hermes
// nor `StyleSheet` can parse. The values below are the same colours resolved to
// sRGB hex at build time, so a native toast is tinted identically to the web
// one. `oklch(L C H)` -> sRGB was resolved with the standard OKLab matrices.
export const STATE_TONES: Record<ToastState, string> = {
  action: "#2b7fff",
  error: "#fb2c36",
  info: "#00a6f4",
  loading: "#737373",
  success: "#3ac530",
  warning: "#f0b100",
};

// Upstream `styles.css` `:root` geometry, in the dp/px that RN uses directly.
export const TOAST_WIDTH = 350;
export const TOAST_HEIGHT = 44;
export const DEFAULT_ROUNDNESS = 18;

// `GOOEY_JOIN`: how far the body overlaps the pill so the union reads as one
// continuous surface. Upstream fuses the two rects with the gooey filter; on
// native the overlap itself is what hides the seam between the same-coloured
// opaque shapes.
export const GOOEY_JOIN = 10;

// `--gooey-duration` and `--gooey-ease` from `styles.css`.
export const GOOEY_DURATION_MS = 260;

// Upstream transitions the content at `0.7 * --gooey-duration`; the pill and
// body rects use the full duration.
export const CONTENT_REVEAL_RATIO = 0.7;

// `cubic-bezier(0.22, 1, 0.36, 1)` expressed as the four control values
// Reanimated/Easing expects.
export const GOOEY_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// `--gooey-shadow` from `apps/web/src/components/auth/shell/gooey-toast.css`,
// including the two inset layers the shell adds on `[data-ready="true"]`.
//
// RN's `boxShadow` takes the same CSS syntax and, unlike the `shadow*` props,
// renders on Android as well as iOS. The web stack hangs the filter off the
// SVG that draws the pill and body; here it hangs off the views that stand in
// for those rects.
export const OUTER_SHADOW =
  "0px 0px 0px 1px rgba(255, 255, 255, 0.06), 0px 2px 3px rgba(0, 0, 0, 0.35), 0px 14px 26px rgba(0, 0, 0, 0.45)";
export const INSET_SHADOW =
  "inset 0px 1px 0px rgba(255, 255, 255, 0.12), inset 0px 2px 4px rgba(0, 0, 0, 0.4)";

// The orange gradient badge from the web shell stylesheet, so the badge matches
// web's `linear-gradient(to bottom, #ff9500, #e65500)` chip rather than the
// library's default tone-tinted circle.
export const BADGE_SIZE = 22.4;
export const BADGE_ICON_SIZE = 12.8;
export const BADGE_TOP_COLOR = "#ff9500";
export const BADGE_BOTTOM_COLOR = "#e65500";
// The dark hairline ring the shell paints around that gradient, plus the two
// inset highlights that give the chip its 3D lip.
export const BADGE_SHADOW =
  "inset 0px 0px 0px 1px rgba(255, 255, 255, 0.25), inset 0px 1px 2px rgba(255, 255, 255, 0.5), 0px 0px 0px 1px rgba(170, 60, 0, 0.95), 0px 1px 1px rgba(255, 255, 255, 0.5), 0px 2px 4px rgba(0, 0, 0, 0.2)";

// `[data-gooey-title] { color: #f5f5f5 }` in the shell stylesheet.
export const TITLE_COLOR = "#f5f5f5";
// `[data-gooey-description] { color: rgba(229, 229, 229, 0.85) }`.
export const DESCRIPTION_COLOR = "rgba(229, 229, 229, 0.85)";

// `--gooey-fill` default when a toast does not pass `fill`.
export const DEFAULT_FILL = "#FFFFFF";

// `color-mix(in oklch, var(--_tone) N%, transparent)` is how upstream tints
// the action button and the timeout track with the state tone. RN needs a real
// rgba(), so the mix is resolved numerically against the tone's own channels.
export const BUTTON_TINT_RATIO = 0.15;
export const TRACK_TINT_RATIO = 0.18;

const clampChannel = (value: number): number =>
  Math.min(255, Math.max(0, value));

// Resolves `#rrggbb` at `ratio` opacity. Only the six-digit form is accepted
// because STATE_TONES is the sole source and every entry is six digits.
export function toneAlpha(tone: string, ratio: number): string {
  const value = Number.parseInt(tone.slice(1), 16);
  const red = Math.floor(value / 65_536) % 256;
  const green = Math.floor(value / 256) % 256;
  const blue = value % 256;
  return `rgba(${clampChannel(red)}, ${clampChannel(green)}, ${clampChannel(blue)}, ${ratio})`;
}

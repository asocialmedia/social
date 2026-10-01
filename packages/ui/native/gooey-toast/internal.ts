import type { ToastAutopilot, ToastPosition } from "./types";

// Port of gooey-toast@0.2.2 `dist/internal.js`. The timing constants are the
// contract the web toasts run on, so they are copied verbatim rather than
// retuned: changing these changes how long a native toast lingers relative to
// web.
export const DEFAULT_DURATION = 6000;
export const AUTO_EXPAND_DELAY = 150;
export const AUTO_COLLAPSE_DELAY = 4000;

// `dist/toast.js` entry/exit and swipe constants. Kept here rather than in
// `theme.ts` because these are behavioural timings, not styling.
export const EXIT_DURATION = 260;
export const SWIPE_DISMISS_DISTANCE = 30;
export const SWIPE_MAX_TRANSLATE = 20;
export const HOVER_RESUME_DELAY = 50;

export const normalizeDuration = (
  value: number | null | undefined
): number | null => (value === undefined ? DEFAULT_DURATION : value);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface ToastPlacement {
  align: "left" | "center" | "right";
  edge: "top" | "bottom";
}

// Upstream's `resolvePlacement`, written out rather than as a nested ternary so
// the align/edge pair reads as the two independent checks it actually is.
export const resolvePlacement = (position: ToastPosition): ToastPlacement => {
  let align: ToastPlacement["align"] = "right";
  if (position.endsWith("left")) {
    align = "left";
  } else if (position.endsWith("center")) {
    align = "center";
  }
  return { align, edge: position.startsWith("top") ? "top" : "bottom" };
};

export interface ResolvedAutopilot {
  autoCollapseDelayMs?: number;
  autoExpandDelayMs?: number;
}

export const resolveAutopilot = (
  options: { autopilot?: boolean | ToastAutopilot },
  duration: number | null
): ResolvedAutopilot => {
  if (options.autopilot === false || duration === null || duration <= 0) {
    return {};
  }
  const config =
    typeof options.autopilot === "object" ? options.autopilot : undefined;
  return {
    autoCollapseDelayMs: clamp(
      config?.collapse ?? AUTO_COLLAPSE_DELAY,
      0,
      duration
    ),
    autoExpandDelayMs: clamp(config?.expand ?? AUTO_EXPAND_DELAY, 0, duration),
  };
};

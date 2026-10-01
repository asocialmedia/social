// React Native port of gooey-toast@0.2.2 — the version apps/web depends on.
//
// Behaviour is a direct port: the same store, the same timing constants, the
// same pill-to-body morph, autopilot expand/collapse, press-to-pause, swipe to
// dismiss, timeout progress bar, promise transitions, positions and offsets.
// See ./README.md for the DOM-to-RN mapping and the one visual concession
// (the gooey SVG filter cannot run on native).

export { GooeyToaster } from "./gooey-toaster";
export type { GooeyToasterProps } from "./gooey-toaster";
export { GooeyToast } from "./gooey-toast";
export type { GooeyToastProps } from "./gooey-toast";
export {
  configureToaster,
  createToaster,
  gooeyToast,
  mountToaster,
  toast,
  unmountToaster,
} from "./toast";
export {
  AUTO_COLLAPSE_DELAY,
  AUTO_EXPAND_DELAY,
  DEFAULT_DURATION,
  resolvePlacement,
} from "./internal";
export type { ToastPlacement } from "./internal";
export { TOAST_POSITIONS } from "./types";
export type {
  ToastAutopilot,
  ToastButton,
  ToastOptions,
  ToastPosition,
  ToastPromiseOptions,
  ToastRenderable,
  ToastState,
  ToastStyles,
  ToasterHandle,
  ToasterOffsetConfig,
  ToasterOffsetValue,
  ToasterOptions,
} from "./types";

// React Native 0.86 exposes a spec-compliant `boxShadow` style prop that
// accepts the same syntax as the web, including multiple comma-separated
// shadows and the `inset` keyword. These recipes are copied verbatim from the
// web 3D surfaces in packages/ui/styles/globals.css so the mobile bevels match
// the browser pixel-for-pixel instead of approximating them with a border plus
// a hand-rolled inner lip line.

// `.premium-input`
export const INPUT_SHADOWS =
  "inset 0 2px 4px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 1px rgba(255, 255, 255, 0.04)";

// `.premium-input:focus`
export const INPUT_FOCUS_SHADOWS =
  "inset 0 1px 2px rgba(0, 0, 0, 0.02), 0 0 0 1px #e65500, 0 0 0 4px rgba(255, 149, 0, 0.25), 0 1px 1px rgba(255, 255, 255, 0.8)";

// `.premium-input` with the `border-destructive/50 bg-destructive/10` state the
// web login form applies when the field fails validation.
export const INPUT_ERROR_SHADOWS =
  "inset 0 2px 4px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 123, 99, 0.55), 0 1px 1px rgba(255, 255, 255, 0.04)";

// `.btn-social`
export const SOCIAL_SHADOWS =
  "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 2px 4px rgba(0, 0, 0, 0.2)";

// `.btn-social:active`
export const SOCIAL_PRESSED_SHADOWS =
  "inset 0 2px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.2)";

// `.btn-3d` (the `premium` Button variant)
export const LOGIN_BUTTON_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.6), 0 3px 5px rgba(0, 0, 0, 0.08), 0 8px 16px -4px rgba(0, 0, 0, 0.15)";

// `.btn-3d:active`
export const LOGIN_BUTTON_PRESSED_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.2), inset 0 1px 2px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 2px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.12)";

// `.dark .icon-btn-3d`
export const ICON_BUTTON_SHADOWS_DARK =
  "inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 1px rgba(255, 255, 255, 0.04)";

// `.icon-btn-3d` (light)
export const ICON_BUTTON_SHADOWS_LIGHT =
  "inset 0 1px 1px rgba(255, 255, 255, 0.7), 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)";

// `.premium-error`
export const ERROR_SHADOWS =
  "inset 0 0 0 1px rgba(255, 120, 100, 0.18), inset 0 2px 4px rgba(0, 0, 0, 0.45), inset 0 -1px 0 rgba(255, 255, 255, 0.04), 0 0 0 1px rgba(180, 180, 180, 0.35), 0 1px 1px rgba(255, 255, 255, 0.04), 0 3px 6px rgba(0, 0, 0, 0.3)";

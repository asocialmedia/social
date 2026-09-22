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

// `.surface-3d` (the dual-border card language: inset white ring + gloss for
// the inner lip, outer hairline, soft drop). The card keeps its own
// theme.cardBorder, which matches the recipe's border on both schemes.
export const SURFACE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.9), inset 0 -2px 4px rgba(0, 0, 0, 0.03), 0 1px 3px rgba(0, 0, 0, 0.06)";

// `.dark .surface-3d`
export const SURFACE_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.06)";

// `.premium-error`
export const ERROR_SHADOWS =
  "inset 0 0 0 1px rgba(255, 120, 100, 0.18), inset 0 2px 4px rgba(0, 0, 0, 0.45), inset 0 -1px 0 rgba(255, 255, 255, 0.04), 0 0 0 1px rgba(180, 180, 180, 0.35), 0 1px 1px rgba(255, 255, 255, 0.04), 0 3px 6px rgba(0, 0, 0, 0.3)";

// `.profile-stats-card` (the inset stat panel inside the profile popover).
export const PROFILE_STATS_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.9), inset 0 -2px 4px rgba(0, 0, 0, 0.03), 0 1px 3px rgba(0, 0, 0, 0.06)";

// `.dark .profile-stats-card`
export const PROFILE_STATS_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.06), inset 0 1px 2px rgba(255, 255, 255, 0.04), inset 0 -2px 4px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.2)";

// `.avatar-ring` (every UserAvatar on web, including the popup's 72px avatar
// which stacks it under the ring-4 ring).
export const AVATAR_RING_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.5), inset 0 1px 2px rgba(255, 255, 255, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.14), 0 1px 2px rgba(0, 0, 0, 0.08)";

// `.dark .avatar-ring`
export const AVATAR_RING_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 1px 2px rgba(255, 255, 255, 0.1), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.35), 0 2px 4px rgba(0, 0, 0, 0.12)";

// `.meta-chip` (inline link/mention/tag pills in authored text).
export const META_CHIP_SHADOWS =
  "inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 1px 2px rgba(0, 0, 0, 0.05)";

// `.dark .meta-chip`
export const META_CHIP_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.15)";

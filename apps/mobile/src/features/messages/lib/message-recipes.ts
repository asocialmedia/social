// The 3D surface recipes the messages UI needs, transcribed from the web CSS
// (packages/ui/styles/globals.css and apps/web/src/app/globals.css) into values a
// React Native StyleSheet can hold.
//
// RN 0.86 takes the CSS `box-shadow` shorthand as a string, including the `inset`
// keyword, so these are the same shadow strings the stylesheet uses rather than a
// re-interpretation of them. Where a recipe is a GRADIENT plus an inset lip (a sent
// bubble, the composer send button), it is returned as a shape for Gradient3D to
// draw, because RN paints an inset shadow over the element's own background and a
// LinearGradient child would erase the lip.
//
// Nothing here is invented. Every value is copied from the web recipe it ports, and
// the light/dark split matches the `.dark` selector the stylesheet uses -- which is
// why these take an `isDark` argument instead of reading a media query.

export const APPLE_PANEL_SHADOWS_MESSAGES_LIGHT =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.8), inset 0 -1px 2px rgba(0, 0, 0, 0.03), 0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.1)";

export const APPLE_PANEL_SHADOWS_MESSAGES_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.2), 0 4px 14px rgba(0, 0, 0, 0.3)";

// `.panel-3d`: floating surfaces. The transcript search overlay, the options
// sheet, the GIF picker, the locked-identity card.
export function panel3d(isDark: boolean) {
  return {
    background: isDark ? "#171717" : "#f3f4f6",
    border: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)",
    shadows: isDark
      ? APPLE_PANEL_SHADOWS_MESSAGES_DARK
      : APPLE_PANEL_SHADOWS_MESSAGES_LIGHT,
  };
}

// `.surface-3d`: in-page raised surfaces. The active conversation row, an
// attachment tile, the details action card.
export function surface3d(isDark: boolean) {
  return {
    background: isDark ? "#171717" : "#f3f4f6",
    border: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
    shadows: isDark
      ? "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.06)"
      : "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.9), inset 0 -2px 4px rgba(0, 0, 0, 0.03), 0 1px 3px rgba(0, 0, 0, 0.06)",
  };
}

// `.chip-3d`: small status chips, e.g. the muted marker in the details header.
export function chip3d(isDark: boolean) {
  return {
    background: isDark ? "#262626" : "#efefef",
    border: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
    shadows: isDark
      ? "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 1px 1px rgba(0, 0, 0, 0.2)"
      : "inset 0 1px 1px rgba(255, 255, 255, 0.7), 0 1px 1px rgba(0, 0, 0, 0.04)",
  };
}

// `.icon-btn-3d` resting: every round icon button in the thread chrome.
export function iconButton3d(isDark: boolean) {
  return isDark
    ? {
        background: "#232323",
        color: "#b4b4b4",
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 1px 1px rgba(255, 255, 255, 0.04)",
      }
    : {
        background: "#f9f9f9",
        color: "#646464",
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.05)",
      };
}

// `.pill-3d-hover:hover`, shown while a row is pressed. Touch has no hover, so the
// press is the moment web's hover treatment reads as.
export function pillHover(isDark: boolean) {
  return isDark
    ? {
        gradient: ["#8f96a3", "#5c6370"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)",
        text: "#ffffff",
      }
    : {
        gradient: ["#e4e7ec", "#c6ccd5"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.06)",
        text: "#1c1f26",
      };
}

// `.bubble-received`: the peer's bubbles, and the decrypt-error bubble.
//
// The web recipe layers a translucent top-lit white gradient over a solid hsl
// fill. RN's LinearGradient draws opaque stops, so the wash is reproduced by the
// gradient's own colour stops over the flat fill, which is what the eye reads.
export function bubbleReceived(isDark: boolean) {
  return {
    border: isDark ? "rgba(255, 255, 255, 0.09)" : "rgba(0, 0, 0, 0.08)",
    shadows: isDark
      ? "inset 0 0 0 1px rgba(255, 255, 255, 0.06), inset 0 1px 1.5px rgba(255, 255, 255, 0.08), inset 0 -1px 2px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.15), 0 2px 5px rgba(0, 0, 0, 0.2)"
      : "inset 0 0 0 1px rgba(255, 255, 255, 0.65), inset 0 1px 1.5px rgba(255, 255, 255, 0.8), inset 0 -1px 2px rgba(0, 0, 0, 0.02), 0 1px 1px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.05)",
    // The solid fill under the wash, then the wash itself: a translucent white band
    // over the top 60% in both themes, just at a different strength.
    surface: isDark ? "#292929" : "hsl(220, 10%, 93.5%)",
    wash: isDark ? "#ffffff0d" : "#ffffff73",
    // The wash fades to fully transparent at 60%, which is where the CSS gradient
    // stops in both themes.
    washTo: "#ffffff00",
  };
}

// `.bubble-sent` is theme-driven, so its recipe takes the resolved theme rather
// than reading a custom property. See conversation-theme.sentBubbleShadows, which
// owns the shadow string, and this for the gradient stops.
export function bubbleSentStops(
  from: string,
  to: string
): readonly [string, string] {
  return [from, to];
}

// `.reels-input`: the composer's field. The web rule rounds it to a pill, but the
// composer overrides that to rounded-2xl, which is what this returns.
export function reelsInput(isDark: boolean) {
  return {
    background: isDark ? "#232323" : "#f9f9f9",
    border: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.12)",
    shadows: isDark
      ? "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.2)"
      : "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.9), inset 0 -2px 4px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06)",
  };
}

// `.follow-btn-3d`: the composer's send button. A gradient plus the dual border,
// so Gradient3D draws it (see the note at the top of this file).
export function sendButton(isDark: boolean) {
  return {
    pressedGradient: ["#e65500", "#d44a00"] as const,
    restingGradient: ["#ff9500", "#e65500"] as const,
    shadows: isDark
      ? "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)"
      : "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 2px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(170, 60, 0, 0.45), 0 1px 1px rgba(255, 255, 255, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1)",
  };
}

// The accent-tinted composer background while a file is being dragged over it.
export const COMPOSER_DRAG_TINT = "rgba(255, 149, 0, 0.05)";

// The scroll-to-latest button's unread count, which is the one place messages uses
// the destructive red rather than the brand orange: it reports something you have
// not looked at, not an action you can take.
export const JUMP_BADGE_BACKGROUND = "#ff3b30";

// The unread badge's orange fill, matching the nav badge.
export const UNREAD_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 1px 2px rgba(0, 0, 0, 0.2)";

// `.msg-jump-shimmer`: the one-shot sweep across a bubble when a search jump lands
// on it. Web drives it with a CSS animation; a component translates an
// Animated.Value instead, gated on reduced motion by the caller.
export const SHIMMER_BAND_WIDTH = 0.5;
export const SHIMMER_DURATION_MS = 800;

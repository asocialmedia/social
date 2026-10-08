// Web 3D recipes the composer and eddie UIs share, copied from
// packages/ui/styles/globals.css and apps/web/src/app/globals.css (light +
// dark). Gradient recipes pair with Gradient3D so the inset lip survives.

export const APPLE_PANEL_TOKENS = {
  dark: {
    background: "#171717",
    border: "rgba(255, 255, 255, 0.12)",
    shadows:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.2), 0 4px 14px rgba(0, 0, 0, 0.3)",
  },
  light: {
    background: "#f3f4f6",
    border: "rgba(0, 0, 0, 0.12)",
    shadows:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1px 2px rgba(255, 255, 255, 0.8), inset 0 -1px 2px rgba(0, 0, 0, 0.03), 0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.1)",
  },
} as const;

// `.panel-3d`: floating surfaces share the same hairline and inset lip.
export function panel3d(isDark: boolean) {
  return isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
}

// `.vote-btn-up` / `.vote-btn-down` 3D dual-border shadows, light + dark.
// Resting vote buttons are bare (web's idle state); the gradient + ring only
// applies while the vote is active.
export const VOTE_UP_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 2px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(170, 60, 0, 0.45), 0 1px 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1)";
export const VOTE_UP_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";
export const VOTE_DOWN_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 2px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(70, 40, 170, 0.45), 0 1px 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1)";
export const VOTE_DOWN_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

// Web's bookmark-button active `shadow-[...]`: same dual-border construction as
// the vote buttons, tuned to the amber fill. One recipe for both themes, as on
// web (no separate light/dark variant there).
export const BOOKMARK_ACTIVE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(150, 90, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

export const BOOKMARK_GRADIENT = ["#fbbf24", "#d97706"] as const;

// `.premium-input` (+ :focus) light + dark.
export function premiumInput(isDark: boolean, focused: boolean) {
  if (isDark) {
    return {
      background: "#232323",
      placeholder: "rgba(232, 232, 232, 0.45)",
      shadows: focused
        ? "inset 0 1px 2px rgba(0, 0, 0, 0.02), 0 0 0 1px #e65500, 0 0 0 4px rgba(255, 149, 0, 0.25), 0 1px 1px rgba(255, 255, 255, 0.8)"
        : "inset 0 2px 4px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 1px rgba(255, 255, 255, 0.04)",
      text: "#e8e8e8",
    };
  }
  return {
    background: "#f9f9f9",
    placeholder: "#646464",
    shadows: focused
      ? "inset 0 1px 2px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(246, 107, 21, 0.5), 0 0 0 3px rgba(246, 107, 21, 0.15)"
      : "inset 0 1px 2px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 1px rgba(0, 0, 0, 0.03)",
    text: "#202020",
  };
}

// Orange primary (send / retry / done / audio play) inline web shadow.
export const ORANGE_BUTTON_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";
export const ORANGE_GRADIENT = ["#ff9500", "#e65500"] as const;
export const ORANGE_PRESSED_GRADIENT = ["#e65500", "#d44a00"] as const;
// `.btn-3d:disabled`: web desaturates a gated pill instead of fading it, so the
// action stays legible rather than dropping to a low-opacity wash.
export const ORANGE_DISABLED_GRADIENT = ["#ffc480", "#ffab66"] as const;
export const PURPLE_GRADIENT = ["#7c5cff", "#5a3ae0"] as const;
export const DARK_CHIP_GRADIENT = ["#3a3f4a", "#23262e"] as const;
export const DARK_CHIP_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 2px 6px rgba(0, 0, 0, 0.35)";

// Web's AiGeneratedBadge: the violet dual-border chip. Its outer ring is violet,
// so it must not borrow the orange primary's ring (ACCENT_CHIP_SHADOWS).
export const AI_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.25)";

// Web's media-viewer ALT badge: zinc (from-zinc-500 to-zinc-700), not the slate
// DARK_CHIP_GRADIENT chrome chip, and it carries its own stronger ring.
export const ALT_BADGE_GRADIENT = ["#71717a", "#3f3f46"] as const;
export const ALT_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(35, 35, 40, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.25)";

// `.orange-3d-surface` (mode toggle active segment) light + dark.
export function orangeSurfaceShadows(isDark: boolean): string {
  return isDark
    ? "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)"
    : "inset 0 0 0 1px rgba(255, 255, 255, 0.5), inset 0 1.5px 2px rgba(255, 255, 255, 0.65), 0 0 0 1px rgba(230, 85, 0, 0.32), 0 1px 2px rgba(190, 75, 0, 0.24), 0 3px 7px -2px rgba(190, 75, 0, 0.26)";
}

// `.icon-btn-3d` resting, light + dark.
export function iconButton(isDark: boolean) {
  return isDark
    ? {
        background: "#232323",
        color: "#b4b4b4",
        shadows:
          "inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 1px rgba(255, 255, 255, 0.04)",
      }
    : {
        background: "#f9f9f9",
        color: "#646464",
        shadows:
          "inset 0 1px 1px rgba(255, 255, 255, 0.7), 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)",
      };
}

// `.pill-3d-hover:hover` / `.icon-btn-3d:hover`, shown while pressed.
export function pressedPill(isDark: boolean) {
  return isDark
    ? {
        color: "#ffffff",
        gradient: ["#8f96a3", "#5c6370"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)",
      }
    : {
        color: "#1c1f26",
        gradient: ["#e4e7ec", "#c6ccd5"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.06)",
      };
}

// `.icon-btn-3d-danger:hover`, shown while pressed.
export function pressedDanger(isDark: boolean) {
  return isDark
    ? {
        color: "#ff8a80",
        gradient: ["#6b2b2b", "#4d1f1f"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 1.5px 2px rgba(255, 255, 255, 0.15), 0 0 0 1px rgba(45, 50, 60, 0.95), 0 1px 1px rgba(255, 255, 255, 0.2), 0 3px 5px rgba(0, 0, 0, 0.2)",
      }
    : {
        color: "#b91c1c",
        gradient: ["#ffd9d9", "#ffbcbc"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.7), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(185, 28, 28, 0.3), 0 1px 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.08)",
      };
}

// `.rail-3d-btn` glass over media.
export const RAIL_BUTTON = {
  background: "rgba(18, 20, 24, 0.45)",
  color: "rgba(255, 255, 255, 0.95)",
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.22), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.25), 0 3px 6px rgba(0, 0, 0, 0.18)",
} as const;

// `.rail-3d-btn-orange` / `-purple` / `-gold`: the active rail states.
const RAIL_ACTIVE_TAIL =
  "0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 6px rgba(0, 0, 0, 0.25)";
const RAIL_ACTIVE_LIP =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.35), inset 0 1.5px 2px rgba(255, 255, 255, 0.5)";
export const RAIL_ACTIVE = {
  gold: {
    colors: ["#fbbf24", "#d97706"],
    shadows: `${RAIL_ACTIVE_LIP}, 0 0 0 1px rgba(150, 90, 0, 0.95), ${RAIL_ACTIVE_TAIL}`,
  },
  orange: {
    colors: ["#ff9500", "#e65500"],
    shadows: `${RAIL_ACTIVE_LIP}, 0 0 0 1px rgba(170, 60, 0, 0.95), ${RAIL_ACTIVE_TAIL}`,
  },
  purple: {
    colors: ["#7c5cff", "#5a3ae0"],
    shadows: `${RAIL_ACTIVE_LIP}, 0 0 0 1px rgba(70, 40, 170, 0.95), ${RAIL_ACTIVE_TAIL}`,
  },
} as const;

// `.follow-btn-3d`, light + dark.
export function followButtonShadows(isDark: boolean): string {
  return isDark
    ? "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)"
    : "inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 2px rgba(255, 255, 255, 0.6), 0 0 0 1px rgba(170, 60, 0, 0.45), 0 1px 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.1)";
}

// `.meta-chip` resting, light + dark.
export function metaChip(isDark: boolean) {
  return isDark
    ? {
        background: "#1f1f1f",
        border: "rgba(255, 255, 255, 0.12)",
        color: "#b4b4b4",
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 2px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.15)",
      }
    : {
        background: "#f9f9f9",
        border: "rgba(0, 0, 0, 0.1)",
        color: "#646464",
        shadows:
          "inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 1px 2px rgba(0, 0, 0, 0.05)",
      };
}

// `.hn-chip` resting, light + dark. The HackerNews feed's metadata pills are
// orange-tinted, not the neutral meta-chip: rgba(255,149,0,0.12) behind an
// orange ink, with a 1px edge just off the fill.
export function hnChip(isDark: boolean) {
  return isDark
    ? {
        background: "rgba(255, 149, 0, 0.12)",
        border: "rgba(251, 146, 60, 0.15)",
        color: "#fdba74",
        shadows:
          "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 1px 1px rgba(255, 255, 255, 0.2)",
      }
    : {
        background: "rgba(255, 149, 0, 0.12)",
        border: "rgba(234, 88, 12, 0.18)",
        color: "#c2410c",
        shadows:
          "inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 1px 1px rgba(154, 52, 18, 0.06)",
      };
}

// `.hn-chip:hover` / `.hn-link:hover`, shown while pressed. Both recipes wash
// to the same orange fill, so one recipe drives the row actions and the pills.
export function hnChipPressed() {
  return {
    gradient: ["#ffb25e", "#f28500"] as const,
    shadows:
      "inset 0 0 0 1px rgba(255, 255, 255, 0.35), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.4), 0 1px 1px rgba(255, 255, 255, 0.4), 0 2px 4px rgba(0, 0, 0, 0.08)",
    text: "#ffffff",
  };
}

// `.hn-link`, light + dark. The row actions ("Reshare as fleet" / "Copy") are
// flat orange text on the page, no fill at rest.
export function hnLink(isDark: boolean) {
  return isDark ? "#fdba74" : "#c2410c";
}

// `.btn-3d-gray` resting + pressed, light + dark. The neutral 3D pill: the
// HackerNews filter trigger is this, not the orange primary.
export function btnGray(isDark: boolean) {
  if (isDark) {
    return {
      pressed: {
        colors: ["#333333", "#2a2a2a"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 1px 2px rgba(255, 255, 255, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 2px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.12)",
        text: "#ffffff",
      },
      resting: {
        colors: ["#4a4a4a", "#333333"] as const,
        shadows:
          "inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 1.5px 2px rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.12), 0 8px 16px -4px rgba(0, 0, 0, 0.2)",
        text: "#ffffff",
      },
    };
  }
  return {
    pressed: {
      colors: ["#dfe3e9", "#cdd2da"] as const,
      shadows:
        "inset 0 0 0 1px rgba(255, 255, 255, 0.6), inset 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)",
      text: "#1f2430",
    },
    resting: {
      colors: ["#f7f8fa", "#e4e7ec"] as const,
      shadows:
        "inset 0 0 0 1px rgba(255, 255, 255, 0.85), inset 0 1.5px 2px rgba(255, 255, 255, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 1px rgba(255, 255, 255, 0.6), 0 1px 2px rgba(0, 0, 0, 0.06)",
      text: "#1f2430",
    },
  };
}

// Theme text colors (--foreground / --muted-foreground / --destructive).
export function themeText(isDark: boolean) {
  return isDark
    ? { destructive: "#ff6b6b", foreground: "#eeeeee", muted: "#b4b4b4" }
    : { destructive: "#dc2626", foreground: "#202020", muted: "#646464" };
}

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
export const PURPLE_GRADIENT = ["#7c5cff", "#5a3ae0"] as const;
export const DARK_CHIP_GRADIENT = ["#3a3f4a", "#23262e"] as const;
export const DARK_CHIP_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 2px 6px rgba(0, 0, 0, 0.35)";

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

// Theme text colors (--foreground / --muted-foreground / --destructive).
export function themeText(isDark: boolean) {
  return isDark
    ? { destructive: "#ff6b6b", foreground: "#eeeeee", muted: "#b4b4b4" }
    : { destructive: "#dc2626", foreground: "#202020", muted: "#646464" };
}

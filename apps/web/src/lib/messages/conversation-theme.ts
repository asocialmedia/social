// Chat themes for a DM. Client-safe (no server imports) because the same table
// is used by the picker that renders the swatches, the thread that paints the
// bubbles, and the API route that validates a submitted key.
//
// The palette lives in TypeScript rather than in CSS so the swatch a member
// clicks and the bubble that repaints cannot drift apart: the thread writes
// these values as custom properties on its root, and the bubble recipes in
// `@layer components` (`.bubble-sent` in packages/ui/styles/globals.css) read
// them. A theme is therefore one object, not one object plus a CSS block.
//
// A theme recolours the member's OWN bubbles. The peer's bubbles keep the
// neutral `bubble-received` recipe, because a chat theme is a personal
// preference and painting the other person's messages would be dressing
// someone else's words in the reader's colours.

export const DEFAULT_CONVERSATION_THEME_KEY = "ember";

export interface ConversationTheme {
  // Custom property names the thread root sets. Exported so the panel writes
  // the same keys the stylesheet reads.
  cssVars: {
    accentFrom: string;
    accentTo: string;
    accentRing: string;
  };
  from: string;
  key: string;
  label: string;
  ring: string;
  to: string;
}

// Ordered as they appear in the picker: the app's own orange leads, then the
// cool end of the wheel, then the dark neutrals. Every pair is a light stop over
// a dark stop so the gradient keeps the same top-lit direction in all of them
// and the 3D inner lip still reads as light catching an edge.
export const CONVERSATION_THEMES: readonly ConversationTheme[] = [
  {
    cssVars: {
      accentFrom: "#ff9500",
      accentRing: "rgba(170, 60, 0, 0.95)",
      accentTo: "#e65500",
    },
    from: "#ff9500",
    key: "ember",
    label: "Ember",
    ring: "rgba(170, 60, 0, 0.95)",
    to: "#e65500",
  },
  {
    cssVars: {
      accentFrom: "#38bdf8",
      accentRing: "rgba(3, 105, 161, 0.95)",
      accentTo: "#0369a1",
    },
    from: "#38bdf8",
    key: "ocean",
    label: "Ocean",
    ring: "rgba(3, 105, 161, 0.95)",
    to: "#0369a1",
  },
  {
    cssVars: {
      accentFrom: "#a78bfa",
      accentRing: "rgba(109, 40, 217, 0.95)",
      accentTo: "#6d28d9",
    },
    from: "#a78bfa",
    key: "grape",
    label: "Grape",
    ring: "rgba(109, 40, 217, 0.95)",
    to: "#6d28d9",
  },
  {
    cssVars: {
      accentFrom: "#fb7185",
      accentRing: "rgba(190, 18, 60, 0.95)",
      accentTo: "#be123c",
    },
    from: "#fb7185",
    key: "rose",
    label: "Rose",
    ring: "rgba(190, 18, 60, 0.95)",
    to: "#be123c",
  },
  {
    cssVars: {
      accentFrom: "#4ade80",
      accentRing: "rgba(21, 128, 61, 0.95)",
      accentTo: "#15803d",
    },
    from: "#4ade80",
    key: "forest",
    label: "Forest",
    ring: "rgba(21, 128, 61, 0.95)",
    to: "#15803d",
  },
  {
    cssVars: {
      accentFrom: "#e4e4e7",
      accentRing: "rgba(63, 63, 70, 0.95)",
      accentTo: "#3f3f46",
    },
    from: "#e4e4e7",
    key: "graphite",
    label: "Graphite",
    ring: "rgba(63, 63, 70, 0.95)",
    to: "#3f3f46",
  },
];

const THEMES_BY_KEY = new Map(
  CONVERSATION_THEMES.map((theme) => [theme.key, theme])
);

// Whether a value from the network is a theme this build can render. Used by the
// API route to reject unknown keys rather than storing something no client can
// paint, and by the thread to treat a stored key it does not know as "default"
// instead of leaving the chat unthemed.
export function isConversationThemeKey(value: unknown): value is string {
  return typeof value === "string" && THEMES_BY_KEY.has(value);
}

// Resolves a stored key to a theme, falling back to the default. Never throws
// and never returns undefined: a key from a newer client, or a cleared
// override, has to render as the app default rather than as an unthemed chat.
export function resolveConversationTheme(
  key: string | null | undefined
): ConversationTheme {
  if (key) {
    const found = THEMES_BY_KEY.get(key);
    if (found) {
      return found;
    }
  }
  return (THEMES_BY_KEY.get(DEFAULT_CONVERSATION_THEME_KEY) ??
    CONVERSATION_THEMES[0]) as ConversationTheme;
}

// Chat themes for a DM. Identical table to apps/web/src/lib/messages/conversation-theme.ts,
// so a theme picked on one client is a key the other already recognises.
//
// A theme recolours the member's OWN bubbles. The peer's bubbles keep the neutral
// received recipe, because a chat theme is a personal preference and painting the
// other person's messages would be dressing someone else's words in the reader's
// colours.

export const DEFAULT_CONVERSATION_THEME_KEY = "ember";

export interface ConversationTheme {
  from: string;
  key: string;
  label: string;
  ring: string;
  to: string;
}

// Ordered as they appear in the picker: the app's own orange leads, then the cool
// end of the wheel, then the dark neutrals. Every pair is a light stop over a dark
// stop so the gradient keeps the same top-lit direction in all of them and the 3D
// inner lip still reads as light catching an edge.
export const CONVERSATION_THEMES: readonly ConversationTheme[] = [
  {
    from: "#ff9500",
    key: "ember",
    label: "Ember",
    ring: "rgba(170, 60, 0, 0.95)",
    to: "#e65500",
  },
  {
    from: "#38bdf8",
    key: "ocean",
    label: "Ocean",
    ring: "rgba(3, 105, 161, 0.95)",
    to: "#0369a1",
  },
  {
    from: "#a78bfa",
    key: "grape",
    label: "Grape",
    ring: "rgba(109, 40, 217, 0.95)",
    to: "#6d28d9",
  },
  {
    from: "#fb7185",
    key: "rose",
    label: "Rose",
    ring: "rgba(190, 18, 60, 0.95)",
    to: "#be123c",
  },
  {
    from: "#4ade80",
    key: "forest",
    label: "Forest",
    ring: "rgba(21, 128, 61, 0.95)",
    to: "#15803d",
  },
  {
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
// sheet to treat a stored key it does not know as "default" instead of leaving
// the chat unthemed.
export function isConversationThemeKey(value: unknown): value is string {
  return typeof value === "string" && THEMES_BY_KEY.has(value);
}

// Resolves a stored key to a theme, falling back to the default. Never throws and
// never returns undefined: a key from a newer client, or a cleared override, has
// to render as the app default.
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

// `.bubble-sent`'s shadow, rebuilt from a theme's stops. Web expresses this as
// custom properties read by a CSS recipe; there is no stylesheet here, so the
// recipe is composed from the same values. Kept in one place so a theme swatch
// and the bubble it paints cannot drift.
export function sentBubbleShadows(theme: ConversationTheme): string {
  return [
    "inset 0 0 0 1px rgba(255, 255, 255, 0.25)",
    "inset 0 1.5px 2px rgba(255, 255, 255, 0.5)",
    `0 0 0 1px ${theme.ring}`,
    "0 1px 1px rgba(255, 255, 255, 0.4)",
    "0 3px 5px rgba(0, 0, 0, 0.12)",
  ].join(", ");
}

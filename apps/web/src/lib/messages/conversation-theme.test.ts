import { describe, expect, test } from "bun:test";

import {
  CONVERSATION_THEMES,
  DEFAULT_CONVERSATION_THEME_KEY,
  isConversationThemeKey,
  resolveConversationTheme,
} from "./conversation-theme";

describe("conversation themes", () => {
  test("keys are unique, so a stored key resolves to exactly one theme", () => {
    const keys = CONVERSATION_THEMES.map((theme) => theme.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every theme carries the stops the swatch and the bubble both read", () => {
    for (const theme of CONVERSATION_THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.from).toMatch(/^#[0-9a-f]{6}$/iu);
      expect(theme.to).toMatch(/^#[0-9a-f]{6}$/iu);
      // The custom properties exist so the swatch gradient and `.bubble-sent`
      // cannot drift: the swatch reads `from`/`to`/`ring`, the recipe reads
      // `cssVars`. They are set from the same values.
      expect(theme.cssVars.accentFrom).toBe(theme.from);
      expect(theme.cssVars.accentTo).toBe(theme.to);
      expect(theme.cssVars.accentRing).toBe(theme.ring);
    }
  });

  test("the app's own orange leads the picker", () => {
    expect(CONVERSATION_THEMES[0]?.key).toBe(DEFAULT_CONVERSATION_THEME_KEY);
  });

  test("isConversationThemeKey accepts a known key and rejects anything else", () => {
    expect(isConversationThemeKey("ocean")).toBe(true);
    expect(isConversationThemeKey("chartreuse")).toBe(false);
    expect(isConversationThemeKey(null)).toBe(false);
    expect(isConversationThemeKey(7)).toBe(false);
  });

  test("resolves a cleared or unknown key to the default", () => {
    // Both must render, never throw: null is "user cleared the override", and
    // an unknown key can come from a client newer than this build.
    expect(resolveConversationTheme(null).key).toBe(
      DEFAULT_CONVERSATION_THEME_KEY
    );
    expect(resolveConversationTheme("from-the-future").key).toBe(
      DEFAULT_CONVERSATION_THEME_KEY
    );
    expect(resolveConversationTheme("ocean").key).toBe("ocean");
  });
});

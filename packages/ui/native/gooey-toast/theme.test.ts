import { describe, expect, test } from "bun:test";

import {
  BADGE_BOTTOM_COLOR,
  BADGE_ICON_SIZE,
  BADGE_SHADOW,
  BADGE_SIZE,
  BADGE_TOP_COLOR,
  BUTTON_TINT_RATIO,
  CONTENT_REVEAL_RATIO,
  DEFAULT_FILL,
  DEFAULT_ROUNDNESS,
  DESCRIPTION_COLOR,
  GOOEY_DURATION_MS,
  GOOEY_EASE,
  GOOEY_JOIN,
  INSET_SHADOW,
  OUTER_SHADOW,
  STATE_TONES,
  TITLE_COLOR,
  TOAST_HEIGHT,
  TOAST_WIDTH,
  toneAlpha,
  TRACK_TINT_RATIO,
} from "./theme";
import { TOAST_POSITIONS } from "./types";
import type { ToastState } from "./types";

const STATES: ToastState[] = [
  "success",
  "loading",
  "error",
  "warning",
  "info",
  "action",
];

// Local mirror of `toneAlpha`'s channel split, written out independently so the
// test would notice if the two ever disagreed about which byte is which. It
// divides rather than bit-shifts precisely because the shifting version is what
// it is checking against, so spelling it differently is the point.
function toneChannels(tone: string): {
  blue: number;
  green: number;
  red: number;
} {
  const value = Number.parseInt(tone.slice(1), 16);
  return {
    blue: value % 256,
    green: Math.floor(value / 256) % 256,
    red: Math.floor(value / 65_536) % 256,
  };
}

describe("STATE_TONES", () => {
  test("covers every state the type declares, and nothing more", () => {
    expect(Object.keys(STATE_TONES).toSorted()).toEqual(STATES.toSorted());
  });

  test("every tone is a six-digit hex colour", () => {
    // `toneAlpha` slices off the leading `#` and parses the rest as hex, so a
    // short form or an `rgb()` here would silently produce nonsense channels.
    for (const state of STATES) {
      expect(STATE_TONES[state]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("no two states share a tone, so a tone always names its state", () => {
    expect(new Set(Object.values(STATE_TONES)).size).toBe(STATES.length);
  });

  test("the tones are legible against the white fill", () => {
    // The surface is opaque white, so a tone close to it would vanish.
    for (const state of STATES) {
      const { red, green, blue } = toneChannels(STATE_TONES[state]);
      expect(0.299 * red + 0.587 * green + 0.114 * blue).toBeLessThan(200);
    }
  });
});

describe("toneAlpha", () => {
  test("splits the hex into red, green and blue channels", () => {
    expect(toneAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(toneAlpha("#00ff00", 1)).toBe("rgba(0, 255, 0, 1)");
    expect(toneAlpha("#0000ff", 0)).toBe("rgba(0, 0, 255, 0)");
  });

  test("places the channels in r, g, b order", () => {
    expect(toneAlpha("#3ac530", 0.5)).toBe("rgba(58, 197, 48, 0.5)");
    expect(toneAlpha("#2b7fff", 0.25)).toBe("rgba(43, 127, 255, 0.25)");
    expect(toneAlpha("#f0b100", 0.18)).toBe("rgba(240, 177, 0, 0.18)");
  });

  test("the alpha is passed through verbatim, ratio and all", () => {
    for (const ratio of [0, 0.15, 0.18, 0.5, 0.72, 1]) {
      expect(toneAlpha("#3ac530", ratio)).toBe(`rgba(58, 197, 48, ${ratio})`);
    }
  });

  test("accepts uppercase hex as well as lowercase", () => {
    expect(toneAlpha("#FF0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  test("works for every declared state tone", () => {
    for (const state of STATES) {
      expect(toneAlpha(STATE_TONES[state], BUTTON_TINT_RATIO)).toMatch(
        /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.15\)$/
      );
    }
  });

  test("reads back exactly what the independent channel split writes", () => {
    for (const state of STATES) {
      const tone = STATE_TONES[state];
      const { red, green, blue } = toneChannels(tone);
      expect(toneAlpha(tone, 0.42)).toBe(
        `rgba(${red}, ${green}, ${blue}, 0.42)`
      );
    }
  });

  test("the tint ratios stay inside the alpha range", () => {
    expect(BUTTON_TINT_RATIO).toBeGreaterThan(0);
    expect(BUTTON_TINT_RATIO).toBeLessThan(1);
    expect(TRACK_TINT_RATIO).toBeGreaterThan(0);
    expect(TRACK_TINT_RATIO).toBeLessThan(1);
  });

  test("the track is tinted a little harder than the action button", () => {
    // Upstream mixes both from the same tone; the track has to stay readable
    // against the fill without competing with the title.
    expect(TRACK_TINT_RATIO).toBeGreaterThan(BUTTON_TINT_RATIO);
  });
});
describe("geometry constants", () => {
  test("match the upstream :root values", () => {
    expect(TOAST_WIDTH).toBe(350);
    expect(TOAST_HEIGHT).toBe(44);
    expect(DEFAULT_ROUNDNESS).toBe(18);
    expect(GOOEY_JOIN).toBe(10);
  });

  test("the pill is wide enough for a short title and flatter than it is round", () => {
    expect(TOAST_WIDTH).toBeGreaterThan(TOAST_HEIGHT);
    // The header width clamps to `TOAST_HEIGHT` at minimum, so a height at or
    // below the roundness would render a circle rather than a pill.
    expect(TOAST_HEIGHT).toBeGreaterThan(DEFAULT_ROUNDNESS * 2);
  });

  test("the gooey overlap is a fraction of the pill, not the whole thing", () => {
    expect(GOOEY_JOIN).toBeGreaterThan(0);
    expect(GOOEY_JOIN).toBeLessThan(TOAST_HEIGHT);
  });
});

describe("animation constants", () => {
  test("the gooey duration matches the exit window the store uses", () => {
    // A pill that morphs for longer than its exit takes would be cut off
    // mid-transition.
    expect(GOOEY_DURATION_MS).toBe(260);
  });

  test("content reveals faster than the pill morphs", () => {
    expect(CONTENT_REVEAL_RATIO).toBeGreaterThan(0);
    expect(CONTENT_REVEAL_RATIO).toBeLessThan(1);
    expect(GOOEY_DURATION_MS * CONTENT_REVEAL_RATIO).toBeLessThan(
      GOOEY_DURATION_MS
    );
  });

  test("the easing is the four upstream cubic-bezier control values", () => {
    expect(GOOEY_EASE).toEqual([0.22, 1, 0.36, 1]);
    expect(GOOEY_EASE).toHaveLength(4);
    for (const value of GOOEY_EASE) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("badge constants", () => {
  test("the icon sits inside the badge", () => {
    expect(BADGE_ICON_SIZE).toBeGreaterThan(0);
    expect(BADGE_ICON_SIZE).toBeLessThan(BADGE_SIZE);
  });

  test("the gradient runs light to dark, top to bottom", () => {
    expect(BADGE_TOP_COLOR).toMatch(/^#[0-9a-f]{6}$/);
    expect(BADGE_BOTTOM_COLOR).toMatch(/^#[0-9a-f]{6}$/);
    expect(BADGE_TOP_COLOR).not.toBe(BADGE_BOTTOM_COLOR);
    const top = toneChannels(BADGE_TOP_COLOR);
    const bottom = toneChannels(BADGE_BOTTOM_COLOR);
    expect(top.red + top.green + top.blue).toBeGreaterThan(
      bottom.red + bottom.green + bottom.blue
    );
  });

  test("the badge shadow is a CSS shadow string with inset layers", () => {
    expect(BADGE_SHADOW).toContain("inset");
    expect(BADGE_SHADOW).toContain("rgba(");
  });
});

describe("shadow and text colours", () => {
  test("both shadow stacks parse as box-shadow values", () => {
    // RN's `boxShadow` takes the same syntax, so an unbalanced rgba would be
    // rejected by the platform at render time.
    for (const shadow of [OUTER_SHADOW, INSET_SHADOW, BADGE_SHADOW]) {
      for (const layer of shadow.split(/,(?![^()]*\))/)) {
        expect(layer.trim().length).toBeGreaterThan(0);
      }
      expect((shadow.match(/\(/g) ?? []).length).toBe(
        (shadow.match(/\)/g) ?? []).length
      );
    }
  });

  test("the outer stack has no inset layer and the inset stack is all inset", () => {
    expect(OUTER_SHADOW).not.toContain("inset");
    expect(INSET_SHADOW.split(/,(?![^()]*\))/)).toHaveLength(2);
    for (const layer of INSET_SHADOW.split(/,(?![^()]*\))/)) {
      expect(layer.trim().startsWith("inset")).toBe(true);
    }
  });

  test("the title is opaque and the description is translucent", () => {
    expect(TITLE_COLOR).toMatch(/^#[0-9a-f]{6}$/);
    expect(DESCRIPTION_COLOR).toMatch(
      /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [\d.]+\)$/
    );
    const alpha = Number(
      DESCRIPTION_COLOR.match(/,\s*(?<alpha>[\d.]+)\)$/)?.groups?.alpha
    );
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  test("the default fill is the opaque white the upstream stylesheet declares", () => {
    expect(DEFAULT_FILL).toBe("#FFFFFF");
  });
});

describe("tones render for every position and state pair", () => {
  test("no combination falls through to a missing tone", () => {
    for (const _position of TOAST_POSITIONS) {
      for (const state of STATES) {
        expect(toneAlpha(STATE_TONES[state], TRACK_TINT_RATIO)).toContain(
          "rgba("
        );
      }
    }
  });
});

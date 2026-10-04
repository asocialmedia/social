import { describe, expect, test } from "bun:test";

import {
  AUTO_COLLAPSE_DELAY,
  AUTO_EXPAND_DELAY,
  clamp,
  DEFAULT_DURATION,
  EXIT_DURATION,
  HOVER_RESUME_DELAY,
  normalizeDuration,
  resolveAutopilot,
  resolvePlacement,
  SWIPE_DISMISS_DISTANCE,
  SWIPE_MAX_TRANSLATE,
} from "./internal";
import type { ToastPlacement } from "./internal";
import { TOAST_POSITIONS } from "./types";
import type { ToastPosition } from "./types";

describe("timing constants", () => {
  // These are the contract the web toasts run on, copied verbatim from
  // gooey-toast@0.2.2 `dist/internal.js`. A retune here changes how long a
  // native toast lingers relative to web, so the values are pinned.
  test("match the upstream timings verbatim", () => {
    expect(DEFAULT_DURATION).toBe(6000);
    expect(AUTO_EXPAND_DELAY).toBe(150);
    expect(AUTO_COLLAPSE_DELAY).toBe(4000);
    expect(EXIT_DURATION).toBe(260);
    expect(SWIPE_DISMISS_DISTANCE).toBe(30);
    expect(SWIPE_MAX_TRANSLATE).toBe(20);
    expect(HOVER_RESUME_DELAY).toBe(50);
  });

  test("autopilot collapses after the toast has had time to be read", () => {
    expect(AUTO_COLLAPSE_DELAY).toBeGreaterThan(AUTO_EXPAND_DELAY);
    // The whole autopilot window must fit inside the default lifetime,
    // otherwise a toast would collapse after it has already been dismissed.
    expect(AUTO_COLLAPSE_DELAY).toBeLessThan(DEFAULT_DURATION);
  });

  test("the swipe threshold exceeds the drag the pill is allowed to show", () => {
    // Below the threshold the toast follows the finger; past it, it leaves.
    expect(SWIPE_MAX_TRANSLATE).toBeLessThan(SWIPE_DISMISS_DISTANCE);
  });
});

describe("clamp", () => {
  test("passes a value inside the range through untouched", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test("clamps to the near and far bounds", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  test("a negative minimum clamps upward as well", () => {
    expect(clamp(-8, -20, -2)).toBe(-8);
    expect(clamp(-30, -20, -2)).toBe(-20);
    expect(clamp(0, -20, -2)).toBe(-2);
  });

  test("an inverted range collapses to the far bound rather than throwing", () => {
    expect(clamp(5, 10, 0)).toBe(0);
  });
});

describe("normalizeDuration", () => {
  test("an absent duration becomes the default", () => {
    // Reading `duration` off a bag that has no such key is how "the caller
    // omitted it" reaches this function, and it is distinct from `null`.
    const omitted: { duration?: number | null } = {};
    expect(normalizeDuration(omitted.duration)).toBe(DEFAULT_DURATION);
  });

  test("null is sticky, so a sticky toast stays sticky", () => {
    expect(normalizeDuration(null)).toBeNull();
  });

  test("an explicit zero is preserved rather than defaulted", () => {
    expect(normalizeDuration(0)).toBe(0);
  });

  test("an explicit duration passes through", () => {
    expect(normalizeDuration(1234)).toBe(1234);
    expect(normalizeDuration(-1)).toBe(-1);
  });
});

describe("resolvePlacement", () => {
  test("resolves all six positions", () => {
    expect(resolvePlacement("top-left")).toEqual({
      align: "left",
      edge: "top",
    });
    expect(resolvePlacement("top-center")).toEqual({
      align: "center",
      edge: "top",
    });
    expect(resolvePlacement("top-right")).toEqual({
      align: "right",
      edge: "top",
    });
    expect(resolvePlacement("bottom-left")).toEqual({
      align: "left",
      edge: "bottom",
    });
    expect(resolvePlacement("bottom-center")).toEqual({
      align: "center",
      edge: "bottom",
    });
    expect(resolvePlacement("bottom-right")).toEqual({
      align: "right",
      edge: "bottom",
    });
  });

  test("covers every declared position, and each is distinct", () => {
    const resolved = TOAST_POSITIONS.map((position) =>
      resolvePlacement(position)
    );
    expect(resolved).toHaveLength(6);
    expect(
      new Set(resolved.map((item) => `${item.edge}-${item.align}`)).size
    ).toBe(6);
    for (const item of resolved) {
      expect(["left", "center", "right"]).toContain(item.align);
      expect(["top", "bottom"]).toContain(item.edge);
    }
  });

  test("align comes from the suffix and edge from the prefix, independently", () => {
    // The two halves are read off separate ends of the string, so a change to
    // one cannot silently drag the other along with it.
    const expected: Record<ToastPosition, ToastPlacement> = {
      "bottom-center": { align: "center", edge: "bottom" },
      "bottom-left": { align: "left", edge: "bottom" },
      "bottom-right": { align: "right", edge: "bottom" },
      "top-center": { align: "center", edge: "top" },
      "top-left": { align: "left", edge: "top" },
      "top-right": { align: "right", edge: "top" },
    };
    for (const position of TOAST_POSITIONS) {
      expect(resolvePlacement(position)).toEqual(expected[position]);
    }
  });
});
describe("resolveAutopilot", () => {
  test("defaults both delays when autopilot is absent or true", () => {
    expect(resolveAutopilot({}, DEFAULT_DURATION)).toEqual({
      autoCollapseDelayMs: AUTO_COLLAPSE_DELAY,
      autoExpandDelayMs: AUTO_EXPAND_DELAY,
    });
    expect(resolveAutopilot({ autopilot: true }, DEFAULT_DURATION)).toEqual({
      autoCollapseDelayMs: AUTO_COLLAPSE_DELAY,
      autoExpandDelayMs: AUTO_EXPAND_DELAY,
    });
  });

  test("autopilot false switches the whole thing off", () => {
    expect(resolveAutopilot({ autopilot: false }, DEFAULT_DURATION)).toEqual(
      {}
    );
  });

  test("a null duration is sticky, so there is nothing to schedule", () => {
    expect(resolveAutopilot({}, null)).toEqual({});
    expect(resolveAutopilot({ autopilot: true }, null)).toEqual({});
    expect(
      resolveAutopilot({ autopilot: { collapse: 100, expand: 50 } }, null)
    ).toEqual({});
  });

  test("a zero or negative duration cannot be scheduled against", () => {
    expect(resolveAutopilot({}, 0)).toEqual({});
    expect(resolveAutopilot({ autopilot: true }, -1)).toEqual({});
  });

  test("an autopilot object overrides each delay independently", () => {
    expect(resolveAutopilot({ autopilot: { expand: 25 } }, 5000)).toEqual({
      autoCollapseDelayMs: AUTO_COLLAPSE_DELAY,
      autoExpandDelayMs: 25,
    });
    expect(resolveAutopilot({ autopilot: { collapse: 900 } }, 5000)).toEqual({
      autoCollapseDelayMs: 900,
      autoExpandDelayMs: AUTO_EXPAND_DELAY,
    });
    expect(
      resolveAutopilot({ autopilot: { collapse: 900, expand: 25 } }, 5000)
    ).toEqual({ autoCollapseDelayMs: 900, autoExpandDelayMs: 25 });
  });

  test("an empty autopilot object falls back to both defaults", () => {
    expect(resolveAutopilot({ autopilot: {} }, DEFAULT_DURATION)).toEqual({
      autoCollapseDelayMs: AUTO_COLLAPSE_DELAY,
      autoExpandDelayMs: AUTO_EXPAND_DELAY,
    });
  });

  test("delays longer than the toast's life are pulled back to it", () => {
    // The default collapse of 4000 would fire after a 2000ms toast is already
    // gone, so it must be clamped to the toast's own duration.
    expect(resolveAutopilot({}, 2000)).toEqual({
      autoCollapseDelayMs: 2000,
      autoExpandDelayMs: AUTO_EXPAND_DELAY,
    });
  });

  test("both delays are clamped up from below at zero", () => {
    expect(
      resolveAutopilot(
        { autopilot: { collapse: -5, expand: -1 } },
        DEFAULT_DURATION
      )
    ).toEqual({ autoCollapseDelayMs: 0, autoExpandDelayMs: 0 });
  });

  test("a delay longer than the duration clamps to the duration, not above", () => {
    expect(
      resolveAutopilot({ autopilot: { collapse: 9999, expand: 8888 } }, 1234)
    ).toEqual({ autoCollapseDelayMs: 1234, autoExpandDelayMs: 1234 });
  });

  test("every scheduled delay lands inside [0, duration]", () => {
    const configs = [
      {},
      { autopilot: true },
      { autopilot: { collapse: 0, expand: 0 } },
      { autopilot: { collapse: 10_000, expand: 10_000 } },
      { autopilot: { collapse: -1, expand: -1 } },
    ];
    for (const options of configs) {
      for (const duration of [1, 17, 150, 999, 6000, 60_000]) {
        const { autoCollapseDelayMs, autoExpandDelayMs } = resolveAutopilot(
          options,
          duration
        );
        for (const delay of [autoCollapseDelayMs, autoExpandDelayMs]) {
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(duration);
        }
      }
    }
  });

  test("switching autopilot off returns neither delay", () => {
    // One delay without the other would leave a timer running that expands a
    // toast the caller never asked to expand.
    for (const duration of [0, -5, null]) {
      const resolved = resolveAutopilot({ autopilot: true }, duration);
      expect(resolved.autoExpandDelayMs).toBeUndefined();
      expect(resolved.autoCollapseDelayMs).toBeUndefined();
    }
  });
});

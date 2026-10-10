import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { clamp } from "./internal";
import { TOAST_HEIGHT, TOAST_WIDTH } from "./theme";

// `alignedX` and the header measurement callback are module-private in
// gooey-toast.tsx: they are a worklet and a `useCallback`, not exports, and
// react-native's entry cannot be evaluated by a bare `bun test` anyway (see
// apps/mobile/src/lib/scroll-indicator.test.ts). So the source is read, each
// function is lifted out by brace matching, and it is evaluated on its own with
// stand-ins for the values it closes over.
//
// That keeps these tests honest about the code that actually ships: if the
// measurement stops adding the safety margin, loses its `<= 0` guard, or starts
// measuring the animated header, the assertions below move. Re-deriving the
// arithmetic by hand would assert nothing at all.
const SOURCE = readFileSync(
  new URL("gooey-toast.tsx", import.meta.url),
  "utf-8"
);

// Upstream's `const safety = 2` in `measureHeaderWidth`. Read from the source
// rather than hardcoded, so a retune surfaces as a failing test.
const HEADER_MEASURE_SAFETY = Number(
  /const HEADER_MEASURE_SAFETY = (?<safety>\d+);/.exec(SOURCE)?.groups?.safety
);

// Returns the source text from `from` through the closing brace of the first
// brace-balanced block that starts after it.
function blockFrom(from: number): string {
  const start = SOURCE.indexOf("{", from);
  let depth = 0;
  for (let index = start; index < SOURCE.length; index += 1) {
    const char = SOURCE[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return SOURCE.slice(from, index + 1);
      }
    }
  }
  throw new Error("unbalanced block in gooey-toast.tsx");
}

// Strips the TypeScript annotations off `expression` and binds it to the named
// free variables, which is how a closed-over `clamp` or shared value is
// supplied to a lifted function body.
function lift<T>(expression: string, names: string[], values: unknown[]): T {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
    `return (${expression});`
  );
  // oxlint-disable-next-line no-new-func -- the body evaluated here is this repo's own source text, not anything user-supplied
  const factory = new Function(...names, js) as (...args: unknown[]) => T;
  return factory(...values);
}

type Align = "left" | "center" | "right";

const alignedXSource = blockFrom(SOURCE.indexOf("function alignedX("));
const alignedX = lift<
  (width: number, align: Align, containerWidth: number) => number
>(alignedXSource, [], []);

const measureHandlerStart = SOURCE.indexOf(
  "(event: LayoutChangeEvent) => {",
  SOURCE.indexOf("const onHeaderMeasureLayout")
);
const measureHandlerSource = blockFrom(measureHandlerStart);

// Runs the lifted measure callback and reads back the shared value it wrote.
// `reportedWidth` is what the hidden measure view laid out to.
function measureHeader(
  containerWidth: number,
  toastHeight: number,
  reportedWidth: number
): number {
  const headerWidth = { value: toastHeight };
  const handler = lift<(event: unknown) => void>(
    measureHandlerSource,
    [
      "clamp",
      "HEADER_MEASURE_SAFETY",
      "headerWidth",
      "containerWidth",
      "toastHeight",
    ],
    [clamp, HEADER_MEASURE_SAFETY, headerWidth, containerWidth, toastHeight]
  );
  handler({ nativeEvent: { layout: { width: reportedWidth } } });
  return headerWidth.value;
}
describe("header measurement contract", () => {
  test("the source exposes the safety margin its comment promises", () => {
    expect(HEADER_MEASURE_SAFETY).toBe(2);
  });

  test("a measured width is grown by the upstream 2px safety margin", () => {
    // A fractional glyph edge can otherwise land exactly on the pill's border
    // and clip it, which is what the margin exists to prevent.
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 200)).toBe(202);
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 200)).toBe(
      200 + HEADER_MEASURE_SAFETY
    );
  });

  test("a fractional width is rounded up before the margin is added", () => {
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 199.2)).toBe(202);
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 200.0001)).toBe(203);
  });

  test("a zero or negative width is ignored and cannot collapse the pill", () => {
    // Upstream guards `if (nextHeaderWidth > 0)`. Without the guard an
    // unlaid-out view reports 0 and the clamp pins the pill shut forever.
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 0)).toBe(TOAST_HEIGHT);
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, -50)).toBe(TOAST_HEIGHT);
  });

  test("the guard holds even when the container is narrower than the pill", () => {
    // The only situation where the guard changes the outcome: with a container
    // below the pill height, `clamp`'s ceiling drops under its own floor, so
    // `clamp(0 + 2, 44, 0)` collapses to 0 and the pill disappears. The
    // unmeasured shared value must therefore be left alone, not overwritten.
    expect(measureHeader(0, TOAST_HEIGHT, 0)).toBe(TOAST_HEIGHT);
    expect(measureHeader(30, TOAST_HEIGHT, 0)).toBe(TOAST_HEIGHT);
    expect(measureHeader(30, TOAST_HEIGHT, -1)).toBe(TOAST_HEIGHT);
  });

  test("a width below the toast height is clamped up to the pill minimum", () => {
    // A short title measures less than the pill is tall; the clamp stops the
    // pill becoming shorter than its own corner radius.
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 1)).toBe(TOAST_HEIGHT);
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 10)).toBe(TOAST_HEIGHT);
  });

  test("the safety margin lands before the clamp, as it does upstream", () => {
    // Upstream returns `ceil(content + safety)` from `measureHeaderWidth` and
    // only then clamps it in `syncMetrics`, so a measurement of 42 plus the 2px
    // margin is exactly the 44 floor, and 43 lands one pixel above it rather
    // than being pulled back down.
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 42)).toBe(TOAST_HEIGHT);
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 43)).toBe(45);
  });

  test("a width above the container is clamped down so the pill cannot overflow", () => {
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 400)).toBe(TOAST_WIDTH);
    expect(measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 10_000)).toBe(TOAST_WIDTH);
  });

  test("the result never leaves [min(toastHeight, container), container]", () => {
    for (const containerWidth of [100, 200, 350, 414]) {
      for (const measured of [0, 1, 43, 44, 100, 199, 350, 999, 100_000]) {
        const result = measureHeader(containerWidth, TOAST_HEIGHT, measured);
        expect(result).toBeGreaterThanOrEqual(
          Math.min(TOAST_HEIGHT, containerWidth)
        );
        expect(result).toBeLessThanOrEqual(containerWidth);
      }
    }
  });

  test("the pill grows past its collapsed minimum once a real width arrives", () => {
    // This is the regression: the toast used to measure its own animated width,
    // which starts at `toastHeight` and reported that straight back, so the
    // clamp pinned the pill to the collapsed minimum forever.
    const grown = measureHeader(TOAST_WIDTH, TOAST_HEIGHT, 240);
    expect(grown).toBeGreaterThan(TOAST_HEIGHT);
    expect(grown).toBe(242);
  });

  test("a taller toast raises the clamp floor with it", () => {
    // The shell overrides `--gooey-height` per toast, and the floor has to
    // follow or a 48dp pill would be clamped back to 44.
    expect(measureHeader(TOAST_WIDTH, 48, 10)).toBe(48);
    expect(measureHeader(TOAST_WIDTH, 48, 200)).toBe(202);
  });

  test("a narrower container tightens the ceiling too", () => {
    expect(measureHeader(200, TOAST_HEIGHT, 240)).toBe(200);
    expect(measureHeader(120, TOAST_HEIGHT, 240)).toBe(120);
  });
});
describe("alignedX", () => {
  test("left pins the shape to the leading edge", () => {
    expect(alignedX(120, "left", 350)).toBe(0);
    expect(alignedX(0, "left", 350)).toBe(0);
    expect(alignedX(350, "left", 350)).toBe(0);
  });

  test("right pushes the shape to the trailing edge", () => {
    expect(alignedX(120, "right", 350)).toBe(230);
    expect(alignedX(350, "right", 350)).toBe(0);
  });

  test("center halves the leftover space, so a centred shape really is centred", () => {
    expect(alignedX(120, "center", 350)).toBe(115);
    // Half the difference, so the shape's midpoint lands on the container's.
    for (const width of [44, 120, 280, 350]) {
      const left = alignedX(width, "center", 350);
      expect(left + width / 2).toBeCloseTo(175);
    }
  });

  test("each alignment is the container minus width times its own factor", () => {
    const factors: Record<Align, number> = { center: 0.5, left: 0, right: 1 };
    for (const [align, factor] of Object.entries(factors)) {
      const resolved = align as Align;
      for (const width of [44, 100, 350]) {
        expect(alignedX(width, resolved, 350)).toBe((350 - width) * factor);
      }
    }
  });

  test("a shape as wide as the container sits at zero for every alignment", () => {
    for (const align of ["center", "left", "right"] as const) {
      expect(alignedX(TOAST_WIDTH, align, TOAST_WIDTH)).toBe(0);
    }
  });

  test("a shape wider than the container goes negative, matching upstream", () => {
    // Upstream does not clamp here either; the width clamp in the measurement
    // pass is what keeps this from ever happening in practice.
    expect(alignedX(400, "right", 350)).toBe(-50);
    expect(alignedX(400, "center", 350)).toBe(-25);
  });

  test("right and center together bracket the leftover space", () => {
    const width = 150;
    const right = alignedX(width, "right", 350);
    const center = alignedX(width, "center", 350);
    const left = alignedX(width, "left", 350);
    expect(center - left).toBeCloseTo(right - center);
  });
});

describe("the measure view is the hidden unconstrained copy", () => {
  // The bug being guarded against was structural, not arithmetic: the toast
  // measured the animated header, whose width is the value being computed.
  // These assertions pin the shape of the fix.
  test("the measure callback is wired to a view styled with `styles.measure`", () => {
    expect(SOURCE).toContain("onLayout={onHeaderMeasureLayout}");
    expect(SOURCE).toContain("style={styles.measure}");
  });

  test("the measure view is invisible and inert", () => {
    const measureStyle = SOURCE.slice(
      SOURCE.indexOf("  measure: {"),
      SOURCE.indexOf("  // The press surface")
    );
    expect(measureStyle).toContain("opacity: 0");
    expect(measureStyle).toContain('position: "absolute"');
  });

  test("the visible header carries no width of its own to be measured against", () => {
    // The animated header is positioned by `headerAnimatedStyle`, so declaring
    // a width in `styles.header` would feed the measurement back into itself.
    const headerStyle = SOURCE.slice(
      SOURCE.indexOf("  header: {"),
      SOURCE.indexOf("  headerBottom:")
    );
    expect(headerStyle).not.toContain("width:");
  });
});

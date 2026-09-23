import { describe, expect, test } from "bun:test";

import { annularSlicePath, buildConicArc, conicColorAt } from "./spinner-arc";

describe("conicColorAt", () => {
  test("is transparent before 72deg", () => {
    expect(conicColorAt(0).opacity).toBe(0);
    expect(conicColorAt(72).opacity).toBe(0);
  });

  test("fades the orange in between 72deg and 140deg", () => {
    const midFade = conicColorAt(106);
    expect(midFade.color).toBe("#ff9500");
    expect(midFade.opacity).toBeCloseTo(0.5, 5);
  });

  test("runs solid from #ff9500 to #e65500 between 140deg and 300deg", () => {
    expect(conicColorAt(140)).toEqual({ color: "#ff9500", opacity: 1 });
    expect(conicColorAt(300)).toEqual({ color: "#e65500", opacity: 1 });
    expect(conicColorAt(220).opacity).toBe(1);
  });

  test("fades the deep orange out by 360deg", () => {
    expect(conicColorAt(330)).toEqual({ color: "#e65500", opacity: 0.5 });
    expect(conicColorAt(360).opacity).toBe(0);
  });
});

describe("annularSlicePath", () => {
  test("starts on the outer radius at 12 o'clock for a 0deg start", () => {
    const path = annularSlicePath({
      center: 28,
      endAngle: 90,
      innerRadius: 20,
      outerRadius: 28,
      startAngle: 0,
    });
    expect(path.startsWith("M 28.000 0.000")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });
});

describe("buildConicArc", () => {
  test("covers 72deg to 360deg and skips invisible slices", () => {
    const slices = buildConicArc({
      center: 28,
      innerRadius: 21.56,
      outerRadius: 28,
      sliceDegrees: 4,
    });
    expect(slices.length).toBe(72);
    expect(slices.every((slice) => slice.opacity > 0)).toBe(true);
    expect(slices[0]?.opacity).toBeLessThan(0.1);
    expect(slices.at(-1)?.opacity).toBeLessThan(0.1);
  });
});

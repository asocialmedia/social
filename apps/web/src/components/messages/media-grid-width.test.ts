import { describe, expect, mock, test } from "bun:test";

import { createDistinctWidthReporter } from "./media-grid-width";

describe("media grid resize reporting", () => {
  test("height-only animation notifications do not trigger width updates", () => {
    const onWidth = mock(() => {});
    const reportWidth = createDistinctWidthReporter(onWidth);
    reportWidth(360);
    for (let frame = 0; frame < 120; frame += 1) {
      reportWidth(360);
    }
    expect(onWidth).toHaveBeenCalledTimes(1);
    expect(onWidth).toHaveBeenCalledWith(360);
  });

  test("orientation and panel width changes still update the grid", () => {
    const widths: number[] = [];
    const reportWidth = createDistinctWidthReporter((width) =>
      widths.push(width)
    );
    reportWidth(360);
    reportWidth(700);
    reportWidth(360);
    expect(widths).toEqual([360, 700, 360]);
  });

  test("subpixel measurements match the initial clientWidth rounding", () => {
    const widths: number[] = [];
    const reportWidth = createDistinctWidthReporter((width) =>
      widths.push(width)
    );
    reportWidth(360);
    reportWidth(359.9);
    reportWidth(360.1);
    reportWidth(360.6);
    expect(widths).toEqual([360, 361]);
  });
});

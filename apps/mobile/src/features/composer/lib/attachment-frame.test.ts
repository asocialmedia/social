import { expect, test } from "bun:test";

import { attachmentFrame } from "./attachment-frame";

test("portrait controls share the media bounds instead of the whole composer row", () => {
  const frame = attachmentFrame(
    { family: "IMAGE", height: 957, isGif: false, width: 611 },
    310
  );
  expect(frame.height).toBeCloseTo(320);
  expect(frame.width).toBeCloseTo((320 * 611) / 957);
});

test("GIFs, landscape images and narrow grid cells fit their available width", () => {
  expect(
    attachmentFrame({ family: "IMAGE", height: 4, isGif: true, width: 2 }, 310)
  ).toEqual({ height: 280, width: 140 });
  expect(
    attachmentFrame(
      { family: "IMAGE", height: 600, isGif: false, width: 1200 },
      300
    )
  ).toEqual({ height: 150, width: 300 });
  const narrow = attachmentFrame(
    { family: "IMAGE", height: 957, isGif: false, width: 611 },
    90
  );
  expect(narrow.width).toBe(90);
  expect(narrow.height).toBeCloseTo((90 * 957) / 611);
});

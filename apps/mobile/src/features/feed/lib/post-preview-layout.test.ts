import { expect, test } from "bun:test";

import {
  fitPreviewFrame,
  mediaAspect,
  postPreviewLayout,
} from "@asm/ui/lib/post-preview-layout";

test("portrait frames keep their aspect and fit narrow feed columns", () => {
  expect(fitPreviewFrame(310, 9 / 16)).toEqual({ height: 380, width: 213.75 });
  expect(fitPreviewFrame(180, 9 / 16)).toEqual({ height: 320, width: 180 });
  expect(fitPreviewFrame(310, 16 / 9)).toEqual({ height: 174.375, width: 310 });
  expect(fitPreviewFrame(310, 1)).toEqual({ height: 310, width: 310 });
});

test("invalid dimensions never create a broken media frame", () => {
  for (const width of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(mediaAspect({ height: 100, width }, 16 / 9)).toBe(16 / 9);
  }
  expect(mediaAspect({ height: 1920, width: 1080 })).toBe(9 / 16);
});

test("post skeletons distinguish text, portrait video, GIF, albums, audio and embeds", () => {
  expect(postPreviewLayout().kind).toBe("unknown");
  expect(postPreviewLayout({ content: "Just text" })).toMatchObject({
    kind: "text",
    textLines: 1,
  });
  expect(
    postPreviewLayout({
      attachments: [{ height: 1920, type: "VIDEO", width: 1080 }],
    })
  ).toMatchObject({ aspectRatio: 9 / 16, kind: "video", textLines: 0 });
  expect(
    postPreviewLayout({
      attachments: [{ height: 240, mimeType: "image/gif", width: 120 }],
    })
  ).toMatchObject({ aspectRatio: 0.5, kind: "image" });
  expect(postPreviewLayout({ attachments: [{}, {}, {}] })).toMatchObject({
    count: 3,
    kind: "album",
  });
  expect(
    postPreviewLayout({ attachments: [{ mimeType: "audio/mpeg" }] }).kind
  ).toBe("audio");
  expect(
    postPreviewLayout({ embeds: [{ url: "https://example.test" }] }).kind
  ).toBe("embed");
});

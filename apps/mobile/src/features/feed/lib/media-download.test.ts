import { describe, expect, test } from "bun:test";

import { mediaDownloadDescriptor } from "./media-download";
import { mediaPreviewLayout } from "./media-preview-layout";

describe("original media actions", () => {
  test("GIF save and share preserve animation instead of downloading a WebP preview", () => {
    expect(
      mediaDownloadDescriptor("https://social.test/", {
        id: "gif1",
        mimeType: "image/gif",
        type: "IMAGE",
      })
    ).toEqual({
      fileName: "asocialmedia-gif1.gif",
      mimeType: "image/gif",
      url: "https://social.test/api/media/gif1",
    });
  });
  test("videos retain their original container and unsafe IDs cannot escape the cache directory", () => {
    const descriptor = mediaDownloadDescriptor("https://social.test", {
      id: "../video?x",
      mimeType: "video/quicktime",
      type: "VIDEO",
    });
    expect(descriptor.fileName).toBe("asocialmedia-videox.mov");
    expect(descriptor.url).toBe("https://social.test/api/media/..%2Fvideo%3Fx");
  });
  test("portrait and landscape previews fit above the drawer without distortion", () => {
    for (const media of [
      { height: 900, width: 400 },
      { height: 900, width: 1600 },
    ]) {
      const layout = mediaPreviewLayout({ height: 950, width: 420 }, media, 40);
      expect(layout.width / layout.height).toBeCloseTo(
        media.width / media.height
      );
      expect(layout.x).toBeGreaterThanOrEqual(8);
      expect(layout.y).toBeGreaterThanOrEqual(40);
      expect(layout.y + layout.height).toBeLessThan(950 * 0.6);
    }
  });
  test("missing dimensions use a finite fallback on small screens", () => {
    const layout = mediaPreviewLayout(
      { height: 400, width: 240 },
      { height: -1, width: 0 },
      24
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.width / layout.height).toBeCloseTo(4 / 3);
  });
  test("a decoded image without metadata lifts at its measured aspect ratio", () => {
    const measured = { height: 216, width: 384, x: 16, y: 180 };
    const layout = mediaPreviewLayout(
      { height: 950, width: 420 },
      {},
      40,
      measured
    );
    expect(layout.width / layout.height).toBeCloseTo(16 / 9);
    expect(layout.width).toBeLessThanOrEqual(404);
  });
  test("portraits use all available height above the actual drawer", () => {
    const layout = mediaPreviewLayout(
      { height: 950, width: 420 },
      { height: 1200, width: 400 },
      40,
      undefined,
      650
    );
    expect(layout.y).toBe(48);
    expect(layout.y + layout.height).toBe(638);
    expect(layout.height).toBeGreaterThan(950 * 0.53);
    expect(layout.width / layout.height).toBeCloseTo(1 / 3);
  });
  test("landscapes use the full width and center within the measured free space", () => {
    const layout = mediaPreviewLayout(
      { height: 950, width: 420 },
      { height: 900, width: 1600 },
      40,
      undefined,
      480
    );
    expect(layout.width).toBe(404);
    expect(layout.x).toBe(8);
    expect(layout.y + layout.height / 2).toBeCloseTo((48 + 468) / 2);
  });
  test("short screens and tall drawers keep the preview separate from the actions", () => {
    const layout = mediaPreviewLayout(
      { height: 400, width: 740 },
      { height: 1920, width: 1080 },
      24,
      undefined,
      180
    );
    expect(layout.height).toBe(136);
    expect(layout.y + layout.height).toBe(168);
    expect(layout.width / layout.height).toBeCloseTo(1080 / 1920);
  });
});

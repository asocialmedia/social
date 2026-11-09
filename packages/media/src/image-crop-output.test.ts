import { describe, expect, test } from "bun:test";

import {
  cropOutputMimeType,
  dataUrlMimeType,
  hasTransparentPixel,
} from "./image-crop-browser";

describe("crop output policy", () => {
  test("opaque pixels encode as JPEG, any transparency keeps PNG", () => {
    const opaque = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    const edge = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 200]);
    expect(cropOutputMimeType(hasTransparentPixel(opaque))).toBe("image/jpeg");
    expect(cropOutputMimeType(hasTransparentPixel(edge))).toBe("image/png");
  });

  test("near-opaque anti-aliasing still counts as opaque", () => {
    expect(hasTransparentPixel(new Uint8ClampedArray([0, 0, 0, 252]))).toBe(
      false
    );
  });

  test("reads the MIME type a data URL carries", () => {
    expect(dataUrlMimeType("data:image/jpeg;base64,AAAA")).toBe("image/jpeg");
    expect(dataUrlMimeType("data:image/svg+xml,<svg/>")).toBe("image/svg+xml");
    expect(dataUrlMimeType("blob:abc")).toBeNull();
  });
});

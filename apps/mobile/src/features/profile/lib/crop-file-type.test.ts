import { describe, expect, test } from "bun:test";

import { cropFileType } from "./crop-file-type";

describe("cropFileType", () => {
  test("an opaque still saves as JPEG", () => {
    expect(cropFileType(false, "data:image/jpeg;base64,AAAA")).toEqual({
      extension: "jpg",
      mimeType: "image/jpeg",
    });
  });

  test("a transparent still keeps PNG", () => {
    expect(cropFileType(false, "data:image/png;base64,AAAA")).toEqual({
      extension: "png",
      mimeType: "image/png",
    });
  });

  test("an animated crop is always a GIF", () => {
    expect(cropFileType(true, "data:image/gif;base64,AAAA")).toEqual({
      extension: "gif",
      mimeType: "image/gif",
    });
  });

  test("an unreadable data URL falls back to PNG, never a mislabelled JPEG", () => {
    expect(cropFileType(false, "not a data url").mimeType).toBe("image/png");
  });
});

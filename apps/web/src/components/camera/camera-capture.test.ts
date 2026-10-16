import { describe, expect, test } from "bun:test";

import { recordingMimeType } from "./camera-capture";

describe("browser camera recording format", () => {
  test("uses supported MP4 for mobile compatibility", () => {
    expect(
      recordingMimeType((mime) => mime === "video/mp4" || mime === "video/webm")
    ).toBe("video/mp4");
  });
  test("falls back to supported WebM instead of forcing unsupported VP9", () => {
    expect(recordingMimeType((mime) => mime === "video/webm")).toBe(
      "video/webm"
    );
    expect(recordingMimeType(() => false)).toBeUndefined();
  });
});

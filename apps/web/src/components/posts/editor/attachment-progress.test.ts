import { describe, expect, test } from "bun:test";

import { getUploadProgressInfo } from "./attachment-preview";

describe("getUploadProgressInfo", () => {
  test("maps stage queued to 55%", () => {
    const info = getUploadProgressInfo("queued", 0);
    expect(info.percent).toBe(55);
    expect(info.label).toBe("55% · Queued…");
  });

  test("maps stage scanning to 75%", () => {
    const info = getUploadProgressInfo("scanning", 0);
    expect(info.percent).toBe(75);
    expect(info.label).toBe("75% · Scanning…");
  });

  test("maps stage processing to 90%", () => {
    const info = getUploadProgressInfo("processing", 0);
    expect(info.percent).toBe(90);
    expect(info.label).toBe("90% · Processing…");
  });

  test("maps uploading progress across 0-100 to 1-50% scale", () => {
    expect(getUploadProgressInfo(undefined, 0)).toEqual({
      label: "1% · Uploading…",
      percent: 1,
    });
    expect(getUploadProgressInfo(undefined, 50)).toEqual({
      label: "25% · Uploading…",
      percent: 25,
    });
    expect(getUploadProgressInfo(undefined, 100)).toEqual({
      label: "50% · Uploading…",
      percent: 50,
    });
  });

  test("clamps boundary progress values correctly", () => {
    expect(getUploadProgressInfo(undefined, -10).percent).toBe(1);
    expect(getUploadProgressInfo(undefined, 200).percent).toBe(50);
  });
});

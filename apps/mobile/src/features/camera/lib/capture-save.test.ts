import { describe, expect, test } from "bun:test";

import { createCaptureSaver } from "./capture-save";

describe("capture gallery persistence", () => {
  test("one capture saves once across simultaneous handoffs and later reuse", async () => {
    let writes = 0;
    const save = createCaptureSaver(async () => {
      writes += 1;
      await Promise.resolve();
      return { saved: true };
    });
    const first = save("file:///photo.jpg");
    expect(save("file:///photo.jpg")).toBe(first);
    expect(await first).toEqual({ saved: true });
    await save("file:///photo.jpg");
    expect(writes).toBe(1);
    await save("file:///video.mp4");
    expect(writes).toBe(2);
  });

  test("denied permissions and failed writes can retry without losing the capture", async () => {
    let attempts = 0;
    const save = createCaptureSaver(async () => {
      await Promise.resolve();
      attempts += 1;
      if (attempts === 1) {
        return { reason: "denied", saved: false };
      }
      if (attempts === 2) {
        throw new Error("Storage temporarily unavailable");
      }
      return { saved: true };
    });
    expect(await save("file:///photo.jpg")).toEqual({
      reason: "denied",
      saved: false,
    });
    expect(await save("file:///photo.jpg")).toEqual({
      reason: "failed",
      saved: false,
    });
    expect(await save("file:///photo.jpg")).toEqual({ saved: true });
    expect(attempts).toBe(3);
  });
});

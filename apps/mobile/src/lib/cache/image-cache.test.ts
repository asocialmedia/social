import { describe, expect, test } from "bun:test";

import { imageCachePolicy } from "./image-cache";

describe("imageCachePolicy", () => {
  test("keeps normal images in memory and disk", () => {
    expect(imageCachePolicy("https://cdn.test/avatar.jpg")).toBe("memory-disk");
    expect(imageCachePolicy("/api/media/photo")).toBe("memory-disk");
  });

  test("keeps GIF originals out of disk", () => {
    expect(imageCachePolicy("https://cdn.test/loop.gif")).toBe("memory");
    expect(imageCachePolicy("https://cdn.test/loop.GIF?width=800")).toBe(
      "memory"
    );
    expect(imageCachePolicy("https://cdn.test/no-extension", true)).toBe(
      "memory"
    );
  });
});

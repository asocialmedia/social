import { describe, expect, test } from "bun:test";

import type { ProfileMedia } from "./profile-view-model";
import { mediaTileAspect } from "./profile-view-model";

function media(overrides: Partial<ProfileMedia> = {}): ProfileMedia {
  return {
    altText: null,
    height: null,
    id: "media-1",
    type: "IMAGE",
    width: null,
    ...overrides,
  } as ProfileMedia;
}

describe("mediaTileAspect", () => {
  test("uses the real dimensions so the tab reads as masonry", () => {
    expect(mediaTileAspect(media({ height: 900, width: 1600 }))).toBeCloseTo(
      16 / 9
    );
    expect(mediaTileAspect(media({ height: 1080, width: 1080 }))).toBe(1);
    // A tall phone shot must stay tall rather than being squared off.
    expect(mediaTileAspect(media({ height: 1920, width: 1080 }))).toBeCloseTo(
      0.5625
    );
  });

  test("falls back to square when the upload recorded no dimensions", () => {
    expect(mediaTileAspect(media())).toBe(1);
    expect(mediaTileAspect(media({ height: 0, width: 0 }))).toBe(1);
    // A zero width with a real height would divide to zero and collapse the
    // tile, so the fallback has to catch the falsy width too.
    expect(mediaTileAspect(media({ height: 900, width: 0 }))).toBe(1);
  });
});

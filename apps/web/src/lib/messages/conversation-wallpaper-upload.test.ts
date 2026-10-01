import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS } from "@asm/media";

import {
  checkWallpaperUpload,
  MAX_WALLPAPER_BYTES,
  MAX_WALLPAPER_EDGE_PX,
  MAX_WALLPAPER_PIXELS,
  MIN_WALLPAPER_EDGE_PX,
  WALLPAPER_ACCEPT,
  WALLPAPER_MIME_TYPES,
  wallpaperMimeFor,
} from "./conversation-wallpaper-upload";

// A candidate that clears every guard, so each test can break exactly one thing
// and be sure the rejection came from the rule it is about.
const good = {
  height: 1080,
  mimeType: "image/png",
  sizeBytes: 1024 * 1024,
  width: 1920,
};

function rejectionOf(candidate: typeof good) {
  const result = checkWallpaperUpload(candidate);
  if (result.ok) {
    throw new Error("expected a rejection");
  }
  return result.rejection;
}

describe("wallpaper format", () => {
  test("accepts each advertised type", () => {
    for (const mimeType of WALLPAPER_MIME_TYPES) {
      expect(checkWallpaperUpload({ ...good, mimeType }).ok).toBe(true);
    }
  });

  test("the accept attribute is derived from the allowlist, not restated", () => {
    // If these ever drift, the OS file picker would offer files that validation
    // then rejects.
    expect(WALLPAPER_ACCEPT).toBe(WALLPAPER_MIME_TYPES.join(","));
  });

  test("rejects a type outside the allowlist", () => {
    expect(rejectionOf({ ...good, mimeType: "image/avif" }).kind).toBe("type");
    expect(rejectionOf({ ...good, mimeType: "image/heic" }).kind).toBe("type");
    expect(rejectionOf({ ...good, mimeType: "image/svg+xml" }).kind).toBe(
      "type"
    );
    expect(rejectionOf({ ...good, mimeType: "application/pdf" }).kind).toBe(
      "type"
    );
    expect(rejectionOf({ ...good, mimeType: "video/mp4" }).kind).toBe("type");
  });

  test("ignores case and parameters, which browsers vary", () => {
    expect(checkWallpaperUpload({ ...good, mimeType: "IMAGE/JPEG" }).ok).toBe(
      true
    );
    expect(
      checkWallpaperUpload({ ...good, mimeType: "image/jpeg;charset=binary" })
        .ok
    ).toBe(true);
  });
});

// Some real files report no type at all: dragging out of certain desktop apps,
// some Android pickers, formats the browser does not recognise. Refusing those
// with "must be a JPG, PNG, WebP or GIF" would reject good bytes, so an empty
// type falls back to the extension. The scan stage's magic-byte check remains
// the authority on what the file actually is.
describe("wallpaper type inference from a filename", () => {
  test("falls back to the extension when the browser reports no type", () => {
    expect(wallpaperMimeFor("", "holiday.JPEG")).toBe("image/jpeg");
    expect(wallpaperMimeFor("", "holiday.jpg")).toBe("image/jpeg");
    expect(wallpaperMimeFor("", "art.PNG")).toBe("image/png");
    expect(wallpaperMimeFor("", "art.webp")).toBe("image/webp");
    expect(wallpaperMimeFor("", "loop.gif")).toBe("image/gif");
  });

  test("prefers a reported type over the extension", () => {
    // A name that lies about its type must not override what the browser said.
    expect(wallpaperMimeFor("image/png", "mislabelled.jpg")).toBe("image/png");
  });

  test("an unknown extension resolves to nothing, so it is refused", () => {
    expect(wallpaperMimeFor("", "photo.heic")).toBe("");
    expect(wallpaperMimeFor("", "noextension")).toBe("");
    const check = checkWallpaperUpload({
      ...good,
      mimeType: wallpaperMimeFor("", "photo.heic"),
    });
    expect(check.ok).toBe(false);
  });

  test("a typeless file with a good extension passes the format check", () => {
    const check = checkWallpaperUpload({
      ...good,
      mimeType: wallpaperMimeFor("", "holiday.JPEG"),
    });
    expect(check.ok).toBe(true);
  });
});

describe("wallpaper size", () => {
  test("the cap is well under the general image cap", () => {
    // A wallpaper is re-fetched on every conversation open, so it must not
    // inherit the 25MB post-image allowance.
    expect(MAX_WALLPAPER_BYTES).toBeLessThan(DEFAULT_LIMITS.maxImageBytes);
    expect(MAX_WALLPAPER_BYTES).toBeGreaterThan(0);
  });

  test("accepts a file exactly at the cap and rejects one byte over", () => {
    expect(
      checkWallpaperUpload({ ...good, sizeBytes: MAX_WALLPAPER_BYTES }).ok
    ).toBe(true);
    expect(
      checkWallpaperUpload({ ...good, sizeBytes: MAX_WALLPAPER_BYTES + 1 }).ok
    ).toBe(false);
  });

  test("rejects an empty file rather than treating it as valid", () => {
    expect(rejectionOf({ ...good, sizeBytes: 0 }).kind).toBe("size");
    expect(rejectionOf({ ...good, sizeBytes: -1 }).kind).toBe("size");
  });

  test("the size message names the real cap in MB", () => {
    const rejection = rejectionOf({
      ...good,
      sizeBytes: MAX_WALLPAPER_BYTES + 1,
    });
    expect(rejection.kind).toBe("size");
    const expected = Math.round(MAX_WALLPAPER_BYTES / (1024 * 1024));
    expect(rejection.message).toContain(`${expected}MB`);
  });
});

describe("wallpaper dimensions", () => {
  test("accepts a file exactly at the minimum short edge", () => {
    expect(
      checkWallpaperUpload({
        ...good,
        height: MIN_WALLPAPER_EDGE_PX,
        width: MIN_WALLPAPER_EDGE_PX,
      }).ok
    ).toBe(true);
  });

  test("rejects an image too small to stay sharp full-screen", () => {
    const rejection = rejectionOf({
      ...good,
      height: MIN_WALLPAPER_EDGE_PX - 1,
      width: 1920,
    });
    expect(rejection.kind).toBe("dimensions");
    // The message quotes the offending edge, so the member knows what to change.
    expect(rejection.message).toContain(String(MIN_WALLPAPER_EDGE_PX - 1));
  });

  test("the short edge is what is measured, so either orientation can fail", () => {
    expect(rejectionOf({ ...good, height: 900, width: 100 }).kind).toBe(
      "dimensions"
    );
    expect(rejectionOf({ ...good, height: 100, width: 900 }).kind).toBe(
      "dimensions"
    );
  });

  test("rejects an absurdly long edge", () => {
    const rejection = rejectionOf({
      ...good,
      height: 200,
      width: MAX_WALLPAPER_EDGE_PX + 1,
    });
    // Caught on the short edge first, which is correct: it is the smaller
    // failure, and both reject the file.
    expect(rejection.kind).toBe("dimensions");
  });

  test("rejects a pixel count that passes both edge checks", () => {
    // 8000x8000 is inside every edge bound but 64M pixels, which is more decode
    // work than a decorative background can justify.
    const rejection = rejectionOf({ ...good, height: 8000, width: 8000 });
    expect(rejection.kind).toBe("dimensions");
    expect(8000 * 8000).toBeGreaterThan(MAX_WALLPAPER_PIXELS);
  });

  test("allows unknown dimensions through, because the link route rechecks them", () => {
    // A browser that cannot decode the file leaves dimensions null. Refusing here
    // would block a legitimate upload on a client quirk; the authoritative check
    // runs on the decoder's own measurements at link time.
    expect(
      checkWallpaperUpload({ ...good, height: null, width: null }).ok
    ).toBe(true);
    expect(
      checkWallpaperUpload({ ...good, height: undefined, width: undefined }).ok
    ).toBe(true);
  });

  test("ignores one-sided dimensions rather than half-validating them", () => {
    // Either both are known or neither is; a lone width is not evidence.
    expect(checkWallpaperUpload({ ...good, height: null }).ok).toBe(true);
    expect(checkWallpaperUpload({ ...good, width: null }).ok).toBe(true);
  });
});

describe("wallpaper check ordering", () => {
  test("reports the type before the size, the size before the dimensions", () => {
    // The order a member can act on: what it is, how big it is, then how many
    // pixels it has. A file that fails all three should only be told about the
    // first.
    const allWrong = {
      height: 10,
      mimeType: "application/pdf",
      sizeBytes: MAX_WALLPAPER_BYTES + 1,
      width: 10,
    };
    expect(rejectionOf(allWrong).kind).toBe("type");
    expect(rejectionOf({ ...allWrong, mimeType: "image/png" }).kind).toBe(
      "size"
    );
  });
});

// Validation rules for a custom chat wallpaper upload. Pure and isomorphic: the
// picker imports it to fail a bad file instantly without a round trip, and the
// upload-initiation route imports the same functions so the two cannot disagree
// about what is allowed.
//
// IMPORTANT: none of this is a security boundary on its own. A browser can be
// told anything, so the declared MIME here is a UX filter, not a check. The
// authoritative format check is the scan stage's magic-byte comparison
// (`verifyDeclaredMatchesContent`), which rejects a renamed executable as
// MIME_MISMATCH before anything is ever published, and the authoritative size
// and dimension checks are the link route's, which read what the decoder
// actually measured rather than what the client claimed. This module exists so a
// member is told "that is too big" in a millisecond instead of after a 25MB
// upload, not so an attacker is stopped.

import { DEFAULT_LIMITS, maxBytesForPurpose } from "@asm/media";

export const MAX_WALLPAPER_BYTES = DEFAULT_LIMITS.maxWallpaperBytes;

// A closed list rather than the pipeline's whole "any image family" policy. A
// wallpaper is a still, full-bleed background, so the formats that carry
// animation (GIF) or multi-frame/lossless-heavy profiles (AVIF, HEIC) are
// excluded: they cost far more bytes than they show behind a dimmed, blurred
// bubble layer. This mirrors the `accept` list the profile avatar/banner inputs
// already use, so the whole app speaks one language about image uploads.
export const WALLPAPER_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

// The `accept` attribute for the file input, derived from the list above so the
// OS picker and the validation cannot drift.
export const WALLPAPER_ACCEPT = WALLPAPER_MIME_TYPES.join(",");

// A wallpaper is painted with `background-size: cover` across the whole
// transcript, so a tiny image would be upscaled into visible mush on any modern
// display. 480px on the shorter edge covers a portrait phone at 1x with room to
// spare and rejects icons, sprites, and cropped avatars.
export const MIN_WALLPAPER_EDGE_PX = 480;

// The longer edge is capped at the same 16384 the upload-initiation schema
// already accepts for client-declared dimensions, so the two agree on what a
// wallpaper may be and nothing is refused here that the schema would allow
// through. It also sits under the pipeline's own 20000 decoder ceiling.
//
// The pixel-count ceiling below is a separate and tighter guard, and it is the
// one that actually binds for a large square: 16384x16384 is 268M pixels, far
// past what any display can show behind a dimmed bubble layer, so an image that
// extreme is refused on pixel count even though it is inside the edge cap.
export const MAX_WALLPAPER_EDGE_PX = 16_384;
export const MAX_WALLPAPER_PIXELS = 40_000_000;

export type WallpaperRejection =
  | { kind: "type"; message: string }
  | { kind: "size"; message: string }
  | { kind: "dimensions"; message: string };

export type WallpaperCheck =
  | { ok: true }
  | { ok: false; rejection: WallpaperRejection };

export interface WallpaperCandidate {
  // The format to check against the allowlist. Pass the browser's `File.type`
  // where available; `wallpaperMimeFor` fills the gap when it is empty.
  mimeType: string;
  sizeBytes: number;
  // Natural dimensions, when the browser could decode them. Null means unknown,
  // and unknown is allowed through here because the link route checks the real
  // measurements later.
  width?: number | null;
  height?: number | null;
}

function isWallpaperMime(mimeType: string): boolean {
  // Browsers report parameters for some types (e.g. "image/jpeg;charset=binary"),
  // so compare the bare type.
  const bare = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return WALLPAPER_MIME_TYPES.includes(bare);
}

// A MIME per accepted extension, used only when the browser reports no type at
// all. `File.type` is genuinely empty for some real files (dragging out of
// certain desktop apps, some Android pickers, formats the browser does not
// recognise), and rejecting those with "must be a JPG, PNG, WebP or GIF" would
// be wrong: the bytes may be perfectly good. The extension is a guess, and the
// scan stage's magic-byte check is what actually decides - so the guess only
// decides whether the upload is worth starting, never whether it is accepted.
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function wallpaperMimeFor(mimeType: string, fileName: string): string {
  if (mimeType) {
    return mimeType;
  }
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "";
}

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

// The full check, in the order a member would want to hear about it: what it is,
// how big it is, then whether it is big enough in pixels to work as a wallpaper.
export function checkWallpaperUpload(
  candidate: WallpaperCandidate
): WallpaperCheck {
  if (!isWallpaperMime(candidate.mimeType)) {
    return {
      ok: false,
      rejection: {
        kind: "type",
        message: "Wallpapers have to be a JPG, PNG, WebP or GIF",
      },
    };
  }

  const maxBytes = maxBytesForPurpose(DEFAULT_LIMITS, "wallpaper", "IMAGE");
  if (candidate.sizeBytes <= 0) {
    return {
      ok: false,
      rejection: { kind: "size", message: "That file is empty" },
    };
  }
  if (candidate.sizeBytes > maxBytes) {
    return {
      ok: false,
      rejection: {
        kind: "size",
        message: `That image is over ${megabytes(maxBytes)}MB, try a smaller one`,
      },
    };
  }

  const { height, width } = candidate;
  if (typeof width === "number" && typeof height === "number") {
    const shortest = Math.min(width, height);
    const longest = Math.max(width, height);
    if (shortest < MIN_WALLPAPER_EDGE_PX) {
      return {
        ok: false,
        rejection: {
          kind: "dimensions",
          message: `That image is only ${shortest}px on its short side. Use one at least ${MIN_WALLPAPER_EDGE_PX}px, so it stays sharp full-screen`,
        },
      };
    }
    if (longest > MAX_WALLPAPER_EDGE_PX) {
      return {
        ok: false,
        rejection: {
          kind: "dimensions",
          message: `That image is ${longest}px on its long side. Use one under ${MAX_WALLPAPER_EDGE_PX}px`,
        },
      };
    }
    if (width * height > MAX_WALLPAPER_PIXELS) {
      return {
        ok: false,
        rejection: {
          kind: "dimensions",
          message:
            "That image has too many pixels to use as a wallpaper. Try a smaller one",
        },
      };
    }
  }

  return { ok: true };
}

// Content-signature detection. The declared filename, extension, and MIME
// type are all untrusted; this module derives what the bytes actually are.
// Detection is deliberately conservative: when the bytes match nothing in the
// allowlist the upload is rejected rather than passed through.

import type { DetectedContent } from "./types";

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function asciiAt(buffer: Buffer, text: string, offset = 0): boolean {
  if (buffer.length < offset + text.length) {
    return false;
  }
  return buffer.toString("latin1", offset, offset + text.length) === text;
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

interface Signature {
  container: string;
  mime: string;
  family: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
  test: (head: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    container: "jpeg",
    family: "IMAGE",
    mime: "image/jpeg",
    test: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    container: "png",
    family: "IMAGE",
    mime: "image/png",
    test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]),
  },
  {
    container: "gif",
    family: "IMAGE",
    mime: "image/gif",
    test: (b) => asciiAt(b, "GIF8", 0),
  },
  {
    container: "webp",
    family: "IMAGE",
    mime: "image/webp",
    test: (b) => asciiAt(b, "RIFF", 0) && asciiAt(b, "WEBP", 8),
  },
  {
    container: "avif",
    family: "IMAGE",
    mime: "image/avif",
    test: (b) =>
      asciiAt(b, "ftyp", 4) &&
      ["avif", "avis"].includes(b.toString("latin1", 8, 12)),
  },
  {
    // HEIF/HEIC family brands (also catches AVIF-adjacent mif1 containers).
    container: "heic",
    family: "IMAGE",
    mime: "image/heic",
    test: (b) => {
      if (!asciiAt(b, "ftyp", 4)) {
        return false;
      }
      const brand = b.toString("latin1", 8, 12);
      return [
        "heic",
        "heim",
        "heis",
        "heix",
        "hevc",
        "hevx",
        "hif",
        "mif1",
        "msf1",
      ].includes(brand);
    },
  },
  {
    container: "tiff",
    family: "IMAGE",
    mime: "image/tiff",
    test: (b) => asciiAt(b, "II*", 0) || asciiAt(b, "MM\u0000", 0),
  },
  {
    container: "ico",
    family: "IMAGE",
    mime: "image/x-icon",
    test: (b) => startsWith(b, [0x00, 0x00, 0x01, 0x00]),
  },
  {
    container: "bmp",
    family: "IMAGE",
    mime: "image/bmp",
    test: (b) => asciiAt(b, "BM", 0),
  },
  {
    // ISO base media: mp4/mov/m4a share ftyp; brand disambiguates below.
    container: "iso-bmff",
    family: "VIDEO",
    mime: "video/mp4",
    test: (b) => asciiAt(b, "ftyp", 4),
  },
  {
    container: "webm-mkv",
    family: "VIDEO",
    mime: "video/webm",
    test: (b) => startsWith(b, EBML_MAGIC),
  },
  {
    container: "avi",
    family: "VIDEO",
    mime: "video/x-msvideo",
    test: (b) => asciiAt(b, "RIFF", 0) && asciiAt(b, "AVI ", 8),
  },
  {
    container: "flv",
    family: "VIDEO",
    mime: "video/x-flv",
    test: (b) => asciiAt(b, "FLV", 0),
  },
  {
    container: "mpeg-audio",
    family: "AUDIO",
    mime: "audio/mpeg",
    test: (b) =>
      asciiAt(b, "ID3", 0) ||
      startsWith(b, [0xff, 0xfb]) ||
      startsWith(b, [0xff, 0xf3]) ||
      startsWith(b, [0xff, 0xf2]),
  },
  {
    container: "ogg",
    family: "AUDIO",
    mime: "audio/ogg",
    test: (b) => asciiAt(b, "OggS", 0),
  },
  {
    container: "flac",
    family: "AUDIO",
    mime: "audio/flac",
    test: (b) => asciiAt(b, "fLaC", 0),
  },
  {
    container: "wav",
    family: "AUDIO",
    mime: "audio/wav",
    test: (b) => asciiAt(b, "RIFF", 0) && asciiAt(b, "WAVE", 8),
  },
  {
    // ADTS AAC raw stream.
    container: "aac-adts",
    family: "AUDIO",
    mime: "audio/aac",
    test: (b) => startsWith(b, [0xff, 0xf1]) || startsWith(b, [0xff, 0xf9]),
  },
];

export interface ContentDetection {
  ok: boolean;
  detected?: DetectedContent;
}

export function detectContent(buffer: Buffer): ContentDetection {
  const head = buffer.subarray(0, Math.min(buffer.length, 512));
  for (const signature of SIGNATURES) {
    if (signature.test(head)) {
      let { mime } = signature;
      let { container } = signature;
      let { family } = signature;
      if (signature.container === "iso-bmff") {
        // Major brand disambiguates mp4/mov/m4a within the same container.
        const brand = head.toString("latin1", 8, 12).trim();
        if (/^M4[AB]$/i.test(brand)) {
          container = "m4a";
          family = "AUDIO";
          mime = "audio/mp4";
        } else if (brand === "qt") {
          container = "mov";
          mime = "video/quicktime";
        }
      }
      if (signature.container === "webm-mkv") {
        // Distinguish WebM from Matroska via the DocType string that follows
        // the EBML header; both start with identical magic.
        const window = buffer.subarray(0, Math.min(buffer.length, 4096));
        mime = window.includes("webm") ? "video/webm" : "video/x-matroska";
        container = window.includes("webm") ? "webm" : "mkv";
      }
      return {
        detected: { container, family, mime },
        ok: true,
      };
    }
  }
  return { ok: false };
}

// Verify the declared MIME family matches what the bytes look like. Returns a
// rejection reason when they disagree; `detected` is returned on success so
// callers can persist it instead of re-sniffing.
export function verifyDeclaredMatchesContent(
  buffer: Buffer,
  declaredMime: string
): ContentDetection & { reason?: string } {
  const detection = detectContent(buffer);
  if (!detection.ok || !detection.detected) {
    return { ok: false, reason: "UNRECOGNIZED_CONTENT" };
  }
  const detectedFamily = detection.detected.family.toLowerCase();
  const declaredFamily = declaredMime.split("/")[0]?.toLowerCase() ?? "";
  const quicktimeAlias =
    declaredFamily === "video" && declaredMime.includes("quicktime");
  const matroskaAlias =
    declaredFamily === "video" && declaredMime.includes("matroska");
  const familyMatch =
    detectedFamily === declaredFamily ||
    (quicktimeAlias && detection.detected.container === "iso-bmff") ||
    (matroskaAlias && detection.detected.container === "webm-mkv");
  if (!familyMatch) {
    return {
      detected: detection.detected,
      ok: false,
      reason: "MIME_MISMATCH",
    };
  }
  return { detected: detection.detected, ok: true };
}

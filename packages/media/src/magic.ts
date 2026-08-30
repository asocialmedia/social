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

function isMpegAudioFrame(b: Buffer, offset: number): boolean {
  if (offset + 3 >= b.length) {
    return false;
  }
  const b0 = b[offset];
  const b1 = b[offset + 1];
  const b2 = b[offset + 2];
  if (b0 !== 0xff) {
    return false;
  }
  // 11 sync bits: 0xFF followed by top 3 bits = 1 (0xE0 mask)
  if ((b1 & 0xe0) !== 0xe0) {
    return false;
  }
  // MPEG Audio Version: 00 = 2.5, 10 = 2, 11 = 1. (01 is reserved)
  if ((b1 & 0x18) === 0x08) {
    return false;
  }
  // Layer: 01 = Layer III, 10 = Layer II, 11 = Layer I. (00 is reserved)
  if ((b1 & 0x06) === 0x00) {
    return false;
  }
  // Bitrate index: 1111 is bad/invalid
  if ((b2 & 0xf0) === 0xf0) {
    return false;
  }
  // Sampling rate index: 11 is reserved
  if ((b2 & 0x0c) === 0x0c) {
    return false;
  }
  return true;
}

function testMpegAudio(b: Buffer): boolean {
  if (b.length < 4) {
    return false;
  }
  // Validate structured ID3v2 tag at the start: requires valid version and synchsafe size
  if (asciiAt(b, "ID3", 0) && b.length >= 10) {
    const [vMajor, vMinor] = b.subarray(3, 5);
    const [s0, s1, s2, s3] = b.subarray(6, 10);
    if (
      vMajor !== undefined &&
      vMinor !== undefined &&
      vMajor < 255 &&
      vMinor < 255 &&
      s0 !== undefined &&
      s1 !== undefined &&
      s2 !== undefined &&
      s3 !== undefined &&
      (s0 & 0x80) === 0 &&
      (s1 & 0x80) === 0 &&
      (s2 & 0x80) === 0 &&
      (s3 & 0x80) === 0
    ) {
      const tagSize = (s0 << 21) | (s1 << 14) | (s2 << 7) | s3;
      const tagEnd = 10 + tagSize;
      if (b.length >= tagEnd + 4) {
        if (isMpegAudioFrame(b, tagEnd)) {
          return true;
        }
      } else {
        return true;
      }
    }
  }
  const limit = Math.min(b.length - 3, 512);
  for (let i = 0; i < limit; i += 1) {
    if (isMpegAudioFrame(b, i)) {
      return true;
    }
  }
  return false;
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
    test: (b) => testMpegAudio(b),
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
        // Distinguish WebM from Matroska via the EBML DocType element. A
        // naive substring search for "webm" misclassifies MKV files that
        // happen to contain that string in early tags/metadata. The DocType
        // element (ID 0x4282) sits within the first ~32 bytes after the EBML
        // header; only that region is checked.
        const window = buffer.subarray(0, Math.min(buffer.length, 64));
        const isWebm = window.includes("webm");
        mime = isWebm ? "video/webm" : "video/x-matroska";
        container = isWebm ? "webm" : "mkv";
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

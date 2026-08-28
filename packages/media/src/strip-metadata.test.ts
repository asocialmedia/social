import { describe, expect, test } from "bun:test";

import { readJpegExifOrientation, stripImageMetadata } from "./strip-metadata";

function u8(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

// Builds a minimal EXIF APP1 payload whose IFD0 carries a single Orientation
// entry. Layout mirrors buildMinimalExifApp1: "Exif\0\0" + TIFF header +
// IFD0 [count][entry][next=0].
function buildExifApp1Payload(orientation: number): Uint8Array {
  const payload = new Uint8Array(6 + 26);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  payload.set([0x49, 0x49], 6); // "II"
  payload[8] = 0x2a;
  payload[10] = 0x08; // IFD0 at TIFF+8
  payload[14] = 0x01; // one entry
  payload[16] = 0x12; // tag 0x0112
  payload[17] = 0x01;
  payload[19] = 0x03; // SHORT
  payload[23] = 0x01; // count
  payload[24] = orientation & 0xff;
  payload[25] = (orientation >> 8) & 0xff;
  return payload;
}

function appSegment(marker: number, payload: Uint8Array): Uint8Array {
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = marker;
  const declared = payload.length + 2;
  segment[2] = (declared >> 8) & 0xff;
  segment[3] = declared & 0xff;
  segment.set(payload, 4);
  return segment;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.codePointAt(0) ?? 0);
}

function buildJpeg(segments: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [u8(0xff, 0xd8), ...segments, u8(0xff, 0xd9)];
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Stand-in entropy-coded stream: SOS header followed by fake scan bytes.
// Real JPEGs place all image data after SOS; the stripper copies it verbatim.
function scanData(): Uint8Array {
  const sos = u8(0xff, 0xda, 0x00, 0x02);
  const payload = ascii("\u0000fake-entropy-data");
  const out = new Uint8Array(sos.length + payload.length);
  out.set(sos, 0);
  out.set(payload, sos.length);
  return out;
}

const PNG_SIGNATURE = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12);
  const { length } = data;
  chunk[0] = (length >> 24) & 0xff;
  chunk[1] = (length >> 16) & 0xff;
  chunk[2] = (length >> 8) & 0xff;
  chunk[3] = length & 0xff;
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.codePointAt(index) ?? 0;
  }
  chunk.set(data, 8);
  // CRC is not validated by the stripper; zero-filled is fine.
  return chunk;
}

function buildPng(chunks: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [PNG_SIGNATURE, ...chunks];
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function riffChunk(fourCc: string, data: Uint8Array): Uint8Array {
  const padded = data.length % 2 === 0 ? data : u8(...data, 0);
  const chunk = new Uint8Array(padded.length + 8);
  for (let index = 0; index < 4; index += 1) {
    chunk[index] = fourCc.codePointAt(index) ?? 0;
  }
  chunk[4] = data.length & 0xff;
  chunk[5] = (data.length >> 8) & 0xff;
  chunk[6] = (data.length >> 16) & 0xff;
  chunk[7] = (data.length >> 24) & 0xff;
  chunk.set(padded, 8);
  return chunk;
}

function buildWebp(chunks: Uint8Array[]): Uint8Array {
  const bodyParts: Uint8Array[] = [ascii("WEBP"), ...chunks];
  let bodySize = 0;
  for (const part of bodyParts) {
    bodySize += part.length;
  }
  const header = u8(
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    (bodySize + 4) & 0xff,
    ((bodySize + 4) >> 8) & 0xff,
    ((bodySize + 4) >> 16) & 0xff,
    ((bodySize + 4) >> 24) & 0xff
  );
  const all: Uint8Array[] = [header, ...bodyParts];
  let total = 0;
  for (const part of all) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of all) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("readJpegExifOrientation", () => {
  test("extracts the orientation value from an EXIF payload", () => {
    const payload = buildExifApp1Payload(6);
    expect(readJpegExifOrientation(payload, 0, payload.length)).toBe(6);
  });

  test("returns 0 for non-EXIF or malformed payloads", () => {
    expect(readJpegExifOrientation(ascii("hello"), 0, 5)).toBe(0);
    expect(readJpegExifOrientation(new Uint8Array(4), 0, 4)).toBe(0);
  });
});

describe("stripImageMetadata: JPEG", () => {
  const iccPayload = ascii("ICC_PROFILE\0fake-icc-bytes");
  const jumbfPayload = ascii("JUMBF\0c2pa-manifest-placeholder");

  test("drops EXIF, XMP, APP13 and COM while keeping JFIF/ICC/C2PA", () => {
    const source = buildJpeg([
      appSegment(0xe0, ascii("JFIF\0standard-header")),
      appSegment(0xe1, buildExifApp1Payload(1)),
      appSegment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmp/>")),
      appSegment(0xe2, iccPayload),
      appSegment(0xeb, jumbfPayload), // APP11 C2PA/JUMBF
      appSegment(0xed, ascii("Photoshop 3.0\0iptc-block")),
      appSegment(0xfe, ascii("editor comments")),
      scanData(),
    ]);

    const result = stripImageMetadata(source);
    expect(result).not.toBeNull();
    expect(result?.stripped).toBe(true);

    const text = Buffer.from(result?.bytes ?? []).toString("latin1");
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("ns.adobe.com");
    expect(text).not.toContain("Photoshop 3.0");
    expect(text).not.toContain("editor comments");
    expect(text).toContain("ICC_PROFILE");
    expect(text).toContain("JUMBF");
    expect(text).toContain("JFIF");
    expect(result?.bytes.length ?? 0).toBeLessThan(source.length);
  });

  test("rebuilds a minimal EXIF carrying Orientation when it was non-default", () => {
    const source = buildJpeg([
      appSegment(0xe1, buildExifApp1Payload(8)),
      scanData(),
    ]);
    const result = stripImageMetadata(source);
    expect(result?.stripped).toBe(true);

    const text = Buffer.from(result?.bytes ?? []).toString("latin1");
    expect(text).toContain("Exif");

    // Locate the rebuilt APP1 and verify only the orientation survives.
    const bytes = result?.bytes ?? new Uint8Array();
    const exifIndex = text.indexOf("Exif") - 4;
    expect(exifIndex).toBeGreaterThan(0);
    const recovered = readJpegExifOrientation(
      bytes,
      exifIndex + 4,
      bytes.length
    );
    expect(recovered).toBe(8);
  });

  test("orientation 1 does not produce a rebuilt EXIF block", () => {
    const source = buildJpeg([
      appSegment(0xe1, buildExifApp1Payload(1)),
      scanData(),
    ]);
    const result = stripImageMetadata(source);
    const text = Buffer.from(result?.bytes ?? []).toString("latin1");
    expect(result?.stripped).toBe(true);
    expect(text).not.toContain("Exif");
  });

  test("already-clean files are returned untouched", () => {
    const source = buildJpeg([
      appSegment(0xe0, ascii("JFIF\0header")),
      scanData(),
    ]);
    const result = stripImageMetadata(source);
    expect(result?.stripped).toBe(false);
    expect(Buffer.from(result?.bytes ?? []).equals(Buffer.from(source))).toBe(
      true
    );
  });
});

describe("stripImageMetadata: PNG", () => {
  test("removes eXIf and text chunks, keeps iCCP and image data", () => {
    const source = buildPng([
      pngChunk("IHDR", u8(0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0)),
      pngChunk("tEXt", ascii("Software\0Malicious Editor")),
      pngChunk("eXIf", ascii("II*\0gps-coordinates")),
      pngChunk("iCCP", ascii("profile\0\0icc-data")),
      pngChunk("IDAT", u8(1, 2, 3, 4)),
      pngChunk("tIME", u8(7, 226, 1, 1, 0, 0, 0)),
      pngChunk("IEND", new Uint8Array(0)),
    ]);

    const result = stripImageMetadata(source);
    expect(result).not.toBeNull();
    expect(result?.stripped).toBe(true);

    const text = Buffer.from(result?.bytes ?? []).toString("latin1");
    expect(text).not.toContain("eXIf");
    expect(text).not.toContain("Software");
    expect(text).not.toContain("tIME");
    expect(text).toContain("iCCP");
    expect(text).toContain("IDAT");
    expect(text).toContain("IEND");
    expect(text).toContain("IHDR");
  });

  test("clean PNGs come back unchanged", () => {
    const source = buildPng([
      pngChunk("IHDR", u8(0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0)),
      pngChunk("IDAT", u8(9)),
      pngChunk("IEND", new Uint8Array(0)),
    ]);
    const result = stripImageMetadata(source);
    expect(result?.stripped).toBe(false);
  });
});

describe("stripImageMetadata: WebP", () => {
  // VP8X flags byte: I(ICC)=0x20 L(alpha)=0x10 E(EXIF)=0x08 A(anim)=0x04 X(XMP)=0x02
  function vp8x(flags: number): Uint8Array {
    return u8(flags, 0, 0, 0, 1, 0, 0, 1, 0, 0); // flags + reserved + canvas 1x1
  }

  test("drops EXIF/XMP chunks, clears their VP8X bits, keeps ICCP", () => {
    const source = buildWebp([
      riffChunk("VP8X", vp8x(0x20 | 0x08 | 0x02)),
      riffChunk("ICCP", ascii("icc-data")),
      riffChunk("EXIF", ascii("II*\0gps")),
      riffChunk("XMP ", ascii("<x:xmp/>")),
      riffChunk("VP8 ", u8(0xaa, 0xbb)),
    ]);

    const result = stripImageMetadata(source);
    expect(result).not.toBeNull();
    expect(result?.stripped).toBe(true);

    const text = Buffer.from(result?.bytes ?? []).toString("latin1");
    expect(text).not.toContain("EXIF");
    expect(text).not.toContain("XMP ");
    expect(text).toContain("ICCP");
    expect(text).toContain("VP8 ");

    // VP8X flags must retain ICC (0x20) but clear E/X bits.
    const vp8xIndex = text.indexOf("VP8X");
    const flags = result?.bytes[vp8xIndex + 8] ?? -1;
    expect(flags & 0x20).toBe(0x20);
    expect(flags & 0x0a).toBe(0);
  });

  test("animated WebP refuses to be stripped", () => {
    const source = buildWebp([
      riffChunk("VP8X", vp8x(0x04)),
      riffChunk("ANIM", u8(0)),
      riffChunk("ANMF", u8(0, 1, 2, 3)),
    ]);
    expect(stripImageMetadata(source)).toBeNull();
  });
});

describe("stripImageMetadata: hostile input", () => {
  test("empty, truncated and garbage inputs return null", () => {
    expect(stripImageMetadata(new Uint8Array(0))).toBeNull();
    expect(stripImageMetadata(u8(0xff, 0xd8))).toBeNull(); // SOI only
    expect(stripImageMetadata(u8(0xff, 0xd8, 0xff))).toBeNull();
    expect(stripImageMetadata(ascii("not an image at all"))).toBeNull();
    // Declared segment longer than the file.
    expect(
      stripImageMetadata(buildJpeg([u8(0xff, 0xe1, 0xff, 0xff, 0x00)]))
    ).toBeNull();
    // PNG with a chunk that runs past EOF.
    const badPng = new Uint8Array(PNG_SIGNATURE.length + 8);
    badPng.set(PNG_SIGNATURE, 0);
    badPng.set(u8(0xff, 0xff, 0xff, 0xff), PNG_SIGNATURE.length);
    expect(stripImageMetadata(badPng)).toBeNull();
  });

  test("output never exceeds input size", () => {
    const source = buildJpeg([
      appSegment(0xe1, buildExifApp1Payload(3)),
      scanData(),
    ]);
    const result = stripImageMetadata(source);
    expect((result?.bytes.length ?? Infinity) <= source.length).toBe(true);
  });
});

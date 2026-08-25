// Lossless metadata stripping for published originals. Static raster uploads
// carry privacy-sensitive containers (EXIF GPS, XMP, Photoshop IPTC, PNG
// text chunks) that must never leave quarantine attached to the served
// bytes. Stripping is done structurally - metadata segments/chunks are
// removed without re-encoding pixels, so there is zero generational quality
// loss and the image renders identically.
//
// Deliberately preserved:
//   JPEG  APP0 (JFIF), APP2 (ICC color profile), APP11 (C2PA/JUMBF),
//         everything from SOS onward
//   PNG   iCCP, gAMA, sRGB and every non-text ancillary chunk
//   WebP  ICCP chunks; animation (ANIM/ANMF) aborts stripping entirely
//
// A lone EXIF Orientation tag survives as a rebuilt minimal APP1: photos
// shot in portrait render rotated in every browser once full EXIF is gone,
// so the tag is extracted, everything else in the block is discarded, and a
// 1-entry TIFF IFD carrying only Orientation is written back.
//
// All parsers are defensive against hostile input: any bounds violation,
// impossible length, or unrecognized structure returns null and the caller
// publishes the scanned-but-unstripped bytes. Output can never exceed input.

export interface StripOutcome {
  bytes: Uint8Array;
  stripped: boolean;
}

const EXIF_SIGNATURE = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] as const;
const ORIENTATION_TAG = 0x01_12;

function startsWithAt(
  source: Uint8Array,
  offset: number,
  prefix: readonly number[] | string
): boolean {
  const { length } = prefix;
  if (offset + length > source.length) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    const expected =
      typeof prefix === "string"
        ? prefix.codePointAt(index)
        : (prefix[index] ?? 0);
    if (source[offset + index] !== expected) {
      return false;
    }
  }
  return true;
}

// Reads Orientation (tag 0x0112, SHORT) from an EXIF APP1 payload starting
// at `offset` (the byte right after the segment length). Returns 0 when the
// structure is absent or malformed - never throws on hostile input.
export function readJpegExifOrientation(
  source: Uint8Array,
  offset: number,
  end: number
): number {
  try {
    if (!startsWithAt(source, offset, EXIF_SIGNATURE)) {
      return 0;
    }
    const tiff = offset + EXIF_SIGNATURE.length;
    if (tiff + 8 > end) {
      return 0;
    }
    const bigEndian = source[tiff] === 0x4d && source[tiff + 1] === 0x4d; // "MM"
    const littleEndian = source[tiff] === 0x49 && source[tiff + 1] === 0x49; // "II"
    if (!bigEndian && !littleEndian) {
      return 0;
    }
    const view = new DataView(
      source.buffer,
      source.byteOffset,
      source.byteLength
    );
    const ifdOffset = view.getUint32(tiff + 4, littleEndian);
    const ifd = tiff + ifdOffset;
    if (ifd + 2 > end) {
      return 0;
    }
    const entryCount = view.getUint16(ifd, littleEndian);
    for (let index = 0; index < entryCount; index += 1) {
      const entry = ifd + 2 + index * 12;
      if (entry + 12 > end) {
        return 0;
      }
      if (view.getUint16(entry, littleEndian) === ORIENTATION_TAG) {
        // SHORT values are stored inline in the first two bytes of the
        // value field regardless of the declared type.
        return view.getUint16(entry + 8, littleEndian);
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

// Minimal EXIF APP1 payload carrying nothing but Orientation: "Exif\0\0" +
// little-endian TIFF header + IFD0 with exactly one entry + null next-IFD.
// Layout (little-endian): "Exif\0\0" + TIFF header (byte order, magic,
// IFD offset 8) + IFD0 [count=1][Orientation entry][next-IFD=0].
function buildMinimalExifApp1(orientation: number): Uint8Array {
  const payload = new Uint8Array(6 + 8 + 2 + 12 + 4);
  payload.set(EXIF_SIGNATURE, 0);
  payload.set([0x49, 0x49], 6); // "II" little-endian
  payload[8] = 0x2a; // TIFF magic
  payload[10] = 0x08; // IFD0 sits 8 bytes into the TIFF block
  payload[14] = 0x01; // one IFD entry
  payload[16] = 0x12; // tag 0x0112 (Orientation), low byte
  payload[17] = 0x01; // tag high byte
  payload[19] = 0x03; // type SHORT
  payload[23] = 0x01; // count = 1
  payload[24] = orientation & 0xff;
  payload[25] = (orientation >> 8) & 0xff;
  return payload;
}

function wrapApp1Segment(payload: Uint8Array): Uint8Array {
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1; // APP1
  const declared = payload.length + 2;
  segment[2] = (declared >> 8) & 0xff;
  segment[3] = declared & 0xff;
  segment.set(payload, 4);
  return segment;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function stripJpeg(source: Uint8Array): StripOutcome | null {
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8) {
    return null;
  }
  const chunks: Uint8Array[] = [source.slice(0, 2)];
  let orientation = 0;
  let changed = false;
  let pos = 2;

  for (;;) {
    if (pos >= source.length) {
      break;
    }
    if (source[pos] !== 0xff) {
      return null;
    }
    const marker = source[pos + 1];
    if (marker === undefined) {
      return null;
    }
    // Standalone markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(source.slice(pos, pos + 2));
      pos += 2;
      continue;
    }
    // EOI and SOS end structured walking: everything through EOI is copied
    // verbatim (entropy-coded data may contain 0xFF xx sequences).
    if (marker === 0xd9 || marker === 0xda) {
      chunks.push(source.slice(pos));
      pos = source.length;
      break;
    }
    const declared = ((source[pos + 2] ?? 0) << 8) | (source[pos + 3] ?? 0);
    if (declared < 2) {
      return null;
    }
    const segmentEnd = pos + 2 + declared;
    if (segmentEnd > source.length) {
      return null;
    }

    if (marker === 0xe1) {
      // APP1 is metadata by construction (image data never lives in APPn):
      // EXIF payloads are mined for Orientation before dropping, every other
      // APP1 (XMP and anything unrecognized) is dropped outright.
      if (startsWithAt(source, pos + 4, EXIF_SIGNATURE)) {
        orientation =
          readJpegExifOrientation(source, pos + 4, segmentEnd) || orientation;
      }
      changed = true;
      pos = segmentEnd;
      continue;
    }
    if (marker === 0xed || marker === 0xfe) {
      // APP13 (Photoshop/IPTC) and COM (freeform comments).
      changed = true;
      pos = segmentEnd;
      continue;
    }

    chunks.push(source.slice(pos, segmentEnd));
    pos = segmentEnd;
  }

  if (!changed) {
    return { bytes: source, stripped: false };
  }

  // Re-insert Orientation right after SOI (before APP0 is tolerated by every
  // mainstream decoder and keeps the rebuild simple).
  if (orientation > 1) {
    chunks.splice(1, 0, wrapApp1Segment(buildMinimalExifApp1(orientation)));
  }

  const bytes = concat(chunks);
  if (bytes.length > source.length) {
    return null;
  }
  return { bytes, stripped: true };
}

function isPng(source: Uint8Array): boolean {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (source.length < 8) {
    return false;
  }
  return SIGNATURE.every((byte, index) => source[index] === byte);
}

const PNG_DROPPED_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function pngChunkType(source: Uint8Array, offset: number): string {
  return String.fromCodePoint(
    source[offset] ?? 0,
    source[offset + 1] ?? 0,
    source[offset + 2] ?? 0,
    source[offset + 3] ?? 0
  );
}

function stripPng(source: Uint8Array): StripOutcome | null {
  if (!isPng(source)) {
    return null;
  }
  const view = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength
  );
  const chunks: Uint8Array[] = [source.slice(0, 8)];
  let changed = false;
  let pos = 8;

  while (pos + 12 <= source.length) {
    const dataLength = view.getUint32(pos);
    const typeOffset = pos + 4;
    const chunkEnd = pos + 12 + dataLength;
    if (chunkEnd > source.length) {
      return null;
    }
    const type = pngChunkType(source, typeOffset);

    // Ancillary text chunks may legally appear after IDAT as well as before
    // it, so the walk continues to IEND instead of stopping at image data.
    if (PNG_DROPPED_CHUNKS.has(type)) {
      changed = true;
      pos = chunkEnd;
      continue;
    }
    chunks.push(source.slice(pos, chunkEnd));
    pos = chunkEnd;
  }
  if (pos !== source.length) {
    return null;
  }
  if (!changed) {
    return { bytes: source, stripped: false };
  }
  const bytes = concat(chunks);
  if (bytes.length > source.length) {
    return null;
  }
  return { bytes, stripped: true };
}

function isWebp(source: Uint8Array): boolean {
  return (
    source.length >= 12 &&
    startsWithAt(source, 0, "RIFF") &&
    startsWithAt(source, 8, "WEBP")
  );
}

// Clears the VP8X presence bits for chunks that were removed so downstream
// parsers do not go looking for EXIF/XMP that no longer exists.
function patchVp8xFlags(payload: Uint8Array, clearMask: number): void {
  if (payload.length >= 1) {
    payload[0] &= ~clearMask & 0xff;
  }
}

function stripWebp(source: Uint8Array): StripOutcome | null {
  if (!isWebp(source)) {
    return null;
  }
  const view = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength
  );
  const chunks: Uint8Array[] = [];
  let changed = false;
  let pos = 12;

  while (pos + 8 <= source.length) {
    const fourCc = pngChunkType(source, pos);
    const payloadLength = view.getUint32(pos + 4, true);
    const payloadStart = pos + 8;
    const paddedEnd = payloadStart + payloadLength + (payloadLength % 2);
    if (payloadLength > source.length || paddedEnd > source.length) {
      return null;
    }

    if (fourCc === "ANIM" || fourCc === "ANMF") {
      // Animated WebP frames must survive untouched - refuse the file.
      return null;
    }

    if (fourCc === "EXIF" || fourCc === "XMP ") {
      changed = true;
      pos = paddedEnd;
      continue;
    }

    if (fourCc === "VP8X") {
      const payload = source.slice(payloadStart, payloadStart + payloadLength);
      // E (EXIF) = 0x08, X (XMP) = 0x02 in the flags byte.
      patchVp8xFlags(payload, 0x08 | 0x02);
      chunks.push(source.slice(pos, payloadStart), payload);
      changed = true;
    } else {
      chunks.push(source.slice(pos, paddedEnd));
    }
    pos = paddedEnd;
  }
  if (pos !== source.length || chunks.length === 0) {
    return null;
  }
  if (!changed) {
    return { bytes: source, stripped: false };
  }

  const body = concat(chunks);
  const riffSize = body.length - 8;
  const bytes = concat([
    source.slice(0, 8),
    new Uint8Array([
      riffSize & 0xff,
      (riffSize >> 8) & 0xff,
      (riffSize >> 16) & 0xff,
      (riffSize >> 24) & 0xff,
    ]),
    body,
  ]);
  if (bytes.length > source.length) {
    return null;
  }
  return { bytes, stripped: true };
}

// Entry point. Returns null whenever the bytes cannot be confidently
// rewritten (unsupported type, animation, malformed structure) so callers
// fall back to publishing the AV-scanned original unmodified.
export function stripImageMetadata(source: Uint8Array): StripOutcome | null {
  if (source.length === 0) {
    return null;
  }
  return stripJpeg(source) ?? stripPng(source) ?? stripWebp(source);
}

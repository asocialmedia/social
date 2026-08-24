// Content-signature checks for uploads. Clients declare a MIME type, but the
// declaration is untrusted: a attacker can label a payload image/png and rely
// on the server storing (and later serving) whatever bytes arrived. These
// checks compare the file's leading bytes against the declared type family
// and reject obvious spoofs. They are deliberately LENIENT by design: unknown
// document formats pass, because the goal is to stop executable/media spoofing,
// not to build a full format registry.

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

// ISO base media file format (mp4, mov, heic, heif, m4a): a 4-byte size then
// the literal "ftyp" box tag at offset 4.
function isIsoBaseMedia(buffer: Buffer): boolean {
  return asciiAt(buffer, "ftyp", 4);
}

function isRiffContainer(buffer: Buffer, format: string): boolean {
  return asciiAt(buffer, "RIFF", 0) && asciiAt(buffer, format, 8);
}

const IMAGE_SIGNATURES: ((buffer: Buffer) => boolean)[] = [
  (b) => startsWith(b, [0xff, 0xd8, 0xff]), // jpeg
  (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]), // png
  (b) => asciiAt(b, "GIF8", 0), // gif
  (b) => isRiffContainer(b, "WEBP"), // webp
  (b) => isIsoBaseMedia(b), // heic / heif / mif1
  (b) => asciiAt(b, "II*", 0) || asciiAt(b, "MM*", 0), // tiff
  (b) => startsWith(b, [0x00, 0x00, 0x01, 0x00]), // ico
];

export interface SniffResult {
  ok: boolean;
  reason?: string;
}

export function sniffFileSignature(
  buffer: Buffer,
  declaredMime: string
): SniffResult {
  const head = buffer.subarray(0, Math.min(buffer.length, 512));

  if (declaredMime.startsWith("image/")) {
    const matched = IMAGE_SIGNATURES.some((check) => check(head));
    return matched
      ? { ok: true }
      : { ok: false, reason: "File content does not match an image format" };
  }

  if (declaredMime.startsWith("video/")) {
    if (
      declaredMime === "video/mp4" ||
      declaredMime === "video/quicktime" ||
      declaredMime === "video/x-matroska"
    ) {
      // mp4/mov carry ftyp; matroska/webm share the EBML header.
      const ebml = startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]);
      const ok = isIsoBaseMedia(head) || ebml;
      return ok
        ? { ok: true }
        : { ok: false, reason: "File content does not match a video format" };
    }
    if (declaredMime === "video/webm") {
      return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])
        ? { ok: true }
        : { ok: false, reason: "File content does not look like WebM" };
    }
    if (declaredMime === "video/x-msvideo") {
      return isRiffContainer(head, "AVI ")
        ? { ok: true }
        : { ok: false, reason: "File content does not look like AVI" };
    }
    if (declaredMime === "video/x-flv") {
      return asciiAt(head, "FLV", 0)
        ? { ok: true }
        : { ok: false, reason: "File content does not look like FLV" };
    }
    // Unknown video subtype: allow, downstream storage treats it as binary.
    return { ok: true };
  }

  if (declaredMime.startsWith("audio/")) {
    if (declaredMime === "audio/mpeg") {
      const id3 = asciiAt(head, "ID3", 0);
      const frame =
        startsWith(head, [0xff, 0xfb]) || startsWith(head, [0xff, 0xf3]);
      return id3 || frame
        ? { ok: true }
        : { ok: false, reason: "File content does not look like MP3" };
    }
    if (declaredMime === "audio/ogg") {
      return asciiAt(head, "OggS", 0)
        ? { ok: true }
        : { ok: false, reason: "File content does not look like Ogg" };
    }
    if (declaredMime === "audio/wav" || declaredMime === "audio/x-wav") {
      return isRiffContainer(head, "WAVE")
        ? { ok: true }
        : { ok: false, reason: "File content does not look like WAV" };
    }
    if (declaredMime === "audio/mp4") {
      return isIsoBaseMedia(head)
        ? { ok: true }
        : { ok: false, reason: "File content does not look like M4A" };
    }
    return { ok: true };
  }

  // Office documents are zip containers.
  if (
    declaredMime.includes("officedocument") ||
    declaredMime.includes("msword") ||
    declaredMime.includes("ms-excel") ||
    declaredMime.includes("ms-powerpoint")
  ) {
    return startsWith(head, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWith(head, [0x50, 0x4b, 0x07, 0x08])
      ? { ok: true }
      : {
          ok: false,
          reason: "File content does not look like an Office document",
        };
  }

  // Text/code and everything unrecognized: lenient pass.
  return { ok: true };
}

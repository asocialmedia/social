// Variant URL parsing for /api/media/{id}/v/{...path}. Pure functions so the
// security-sensitive filename rules are unit-testable in isolation.

export const DERIVATIVE_MIME_BY_EXT: Record<string, string> = {
  avif: "image/avif",
  jpg: "image/jpeg",
  json: "application/json",
  m3u8: "application/vnd.apple.mpegurl",
  m4a: "audio/mp4",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  webm: "audio/webm",
  webp: "image/webp",
};

export type VariantRequest =
  | { hlsFile: string }
  | { kind: string; variant: string };

const HLS_GENERATION_RE =
  /^v\d{1,3}\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function hlsGeneration(masterKey: string): string | null {
  const parts = masterKey.split("/");
  const value = `${parts[1]}.${parts[3]}`;
  return parts.length === 6 &&
    parts[0] === "derived" &&
    parts[4] === "hls" &&
    HLS_GENERATION_RE.test(value)
    ? value
    : null;
}

export function hlsGenerationKey(
  mediaId: string,
  generation: string,
  filename: string
): string | null {
  if (
    !HLS_GENERATION_RE.test(generation) ||
    !/^[A-Za-z0-9_-]+$/.test(mediaId) ||
    !isSafeHlsFilename(filename)
  ) {
    return null;
  }
  const [version, id] = generation.split(".");
  return `derived/${version}/${mediaId}/${id}/hls/${filename}`;
}

export function pinHlsManifest(manifest: string, generation: string): string {
  if (!HLS_GENERATION_RE.test(generation)) {
    throw new Error("Invalid HLS generation");
  }
  return manifest
    .split("\n")
    .map((line) => {
      if (isSafeHlsFilename(line.trim())) {
        return `${line.trim()}?g=${generation}`;
      }
      return line.replaceAll(
        /URI="(?<file>[A-Za-z0-9._-]+)"/g,
        (match: string, file: string) =>
          isSafeHlsFilename(file) ? `URI="${file}?g=${generation}"` : match
      );
    })
    .join("\n");
}

const HLS_PREFIX = "hls/";

// Single-segment names without a variant suffix: poster.jpg, cover.jpg
const SIMPLE_NAME_RE = /^(?<kind>[a-z]+)\.(?<ext>jpg)$/;

// kind-variant.ext where kind is lowercase-dash-digit (mp4), variant is
// alphanumeric.
const QUALIFIED_NAME_RE =
  /^(?<kind>[a-z][a-z0-9-]*)-(?<variant>[a-z0-9]+)\.(?<ext>avif|webp|jpg|json|mp4|m4a|webm)$/;

// HLS segment filenames must be flat, short, extension-restricted tokens so
// the storage key can be rebuilt from the stored master key without trusting
// client path structure.
const SEGMENT_FILE_RE = /^[a-zA-Z0-9._-]{1,128}$/;
const HLS_ALLOWED_EXTENSIONS = new Set([".m4s", ".mp4", ".m3u8"]);

export function isSafeHlsFilename(file: string): boolean {
  if (
    ![...HLS_ALLOWED_EXTENSIONS].some((extension) => file.endsWith(extension))
  ) {
    return false;
  }
  return SEGMENT_FILE_RE.test(file);
}

export function parseVariantRequest(segments: string[]): VariantRequest | null {
  const path = segments.join("/");
  if (!path || path.length > 200) {
    return null;
  }

  if (path.startsWith(HLS_PREFIX)) {
    const file = path.slice(HLS_PREFIX.length);
    // Reject anything with separators or traversal outright.
    return file.includes("/") || !isSafeHlsFilename(file)
      ? null
      : { hlsFile: file };
  }

  const simple = SIMPLE_NAME_RE.exec(path);
  if (simple?.groups) {
    return { kind: simple.groups.kind, variant: "default" };
  }

  const qualified = QUALIFIED_NAME_RE.exec(path);
  if (!qualified?.groups) {
    return null;
  }
  const { kind } = qualified.groups;
  // "hls-..." through the qualified parser would collide with the reserved
  // HLS namespace; force those through the hls/ prefix instead.
  if (kind === "hls") {
    return null;
  }
  return { kind, variant: qualified.groups.variant };
}

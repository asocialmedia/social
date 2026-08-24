// Object-storage key layout. All keys live inside the single private bucket;
// nothing under quarantine/ is ever exposed through a public read path, and
// derivative keys are deterministic so retries overwrite cleanly instead of
// accumulating duplicates.

export const QUARANTINE_PREFIX = "quarantine";
export const MEDIA_PREFIX = "media";
export const DERIVED_PREFIX = "derived";

// Sanitize a client-supplied extension into something safe for object keys:
// lowercase, alphanumeric only, 1-5 chars, no traversal.
export function sanitizeExtension(raw: string | null | undefined): string {
  const ext = (raw ?? "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "")
    .slice(0, 5);
  return ext.length > 0 ? ext : "bin";
}

export function quarantineKey(mediaId: string, extension: string): string {
  return `${QUARANTINE_PREFIX}/${mediaId}/original.${sanitizeExtension(extension)}`;
}

export function publishedKey(
  mediaId: string,
  extension: string,
  sha256Hex: string
): string {
  // Content-hash suffix makes integrity visible in the key and prevents a
  // re-encoded original from silently clobbering the previous one.
  return `${MEDIA_PREFIX}/${mediaId}/original-${sha256Hex.slice(0, 16)}.${sanitizeExtension(extension)}`;
}

export function derivativeKey(
  pipelineVersion: string,
  mediaId: string,
  name: string
): string {
  return `${DERIVED_PREFIX}/v${pipelineVersion}/${mediaId}/${name}`;
}

export function derivativeName(
  kind: string,
  variant: string,
  extension: string
): string {
  const variantPart = variant && variant !== "default" ? `-${variant}` : "";
  return `${kind}${variantPart}.${sanitizeExtension(extension)}`;
}

// HLS segments are addressed as `${hlsBase}/${file}`; the base is derived from
// the stored master-playlist key so the serving proxy never needs to trust a
// client-provided path beyond one sanitized filename.
export function hlsBaseFromMasterKey(masterKey: string): string {
  const idx = masterKey.lastIndexOf("/");
  return idx === -1 ? "" : masterKey.slice(0, idx);
}

const SEGMENT_FILE_RE = /^[a-zA-Z0-9._-]{1,128}$/;

export function isSafeHlsFilename(file: string): boolean {
  if (
    !file.endsWith(".m4s") &&
    !file.endsWith(".mp4") &&
    !file.endsWith(".m3u8")
  ) {
    return false;
  }
  return SEGMENT_FILE_RE.test(file);
}

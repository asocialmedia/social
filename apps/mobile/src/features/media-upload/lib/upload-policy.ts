// Upload policy shared by the native composers, mirroring web's
// lib/media/upload-policy.ts, packages/media/src/limits.ts (DEFAULT_LIMITS,
// MAX_POST_ATTACHMENTS) and the editor's createMediaTypeGate. The server is
// authoritative (initiate/finalize re-check everything and the worker sniffs
// magic bytes); these checks only fail fast with the same copy web shows.

export type MediaFamily = "AUDIO" | "IMAGE" | "VIDEO";

export const MAX_POST_ATTACHMENTS = 10;
export const MAX_COMMENT_ATTACHMENTS = 1;

// DEFAULT_LIMITS byte caps.
export const MAX_BYTES: Record<MediaFamily, number> = {
  AUDIO: 50 * 1024 * 1024,
  IMAGE: 25 * 1024 * 1024,
  VIDEO: 250 * 1024 * 1024,
};

// Server switches to a multipart upload above this size, in 16 MiB parts.
export const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
export const DEFAULT_PART_SIZE = 16 * 1024 * 1024;

export class UploadPolicyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadPolicyError";
    this.status = status;
  }
}

// mediaTypeFromMime: family from the mime prefix; SVG and text-like payloads
// are hard-blocked product-wide.
export function familyFromMime(mime: string): MediaFamily {
  const lower = mime.toLowerCase();
  if (lower === "image/svg+xml" || lower.startsWith("text/")) {
    throw new UploadPolicyError(`Unsupported file type: ${mime}`, 415);
  }
  const prefix = lower.split("/")[0] ?? "";
  if (prefix === "image") {
    return "IMAGE";
  }
  if (prefix === "video") {
    return "VIDEO";
  }
  if (prefix === "audio") {
    return "AUDIO";
  }
  throw new UploadPolicyError(`Unsupported file type: ${mime}`, 415);
}

const FAMILY_LABEL: Record<MediaFamily, string> = {
  AUDIO: "Audio files",
  IMAGE: "Images",
  VIDEO: "Videos",
};

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

// Client pre-check before any network call.
export function assertUploadable(mime: string, size: number): MediaFamily {
  const family = familyFromMime(mime);
  if (!Number.isFinite(size) || size <= 0) {
    throw new UploadPolicyError("This file is empty.", 400);
  }
  const cap = MAX_BYTES[family];
  if (size > cap) {
    throw new UploadPolicyError(
      `${FAMILY_LABEL[family]} can be up to ${formatMegabytes(cap)}.`,
      413
    );
  }
  return family;
}

export interface PartPlan {
  end: number;
  partNumber: number;
  start: number;
}

// Byte ranges for a multipart upload: 1-based part numbers, the last part
// carrying the remainder.
export function planParts(size: number, partSize: number): PartPlan[] {
  if (size <= 0 || partSize <= 0) {
    return [];
  }
  const parts: PartPlan[] = [];
  for (let partNumber = 1, start = 0; start < size; partNumber += 1) {
    const end = Math.min(size, start + partSize);
    parts.push({ end, partNumber, start });
    start = end;
  }
  return parts;
}

export interface DraftMediaKind {
  family: MediaFamily;
  isGif: boolean;
}

function isExclusive(kind: DraftMediaKind): boolean {
  return kind.family === "AUDIO" || kind.isGif;
}

export type GateVerdict =
  | { ok: true }
  | { ok: false; reason: "exclusive" | "gust" | "limit" };

// createMediaTypeGate: audio and GIF are exclusive (one per post, nothing
// alongside); images and videos mix freely; a gust takes exactly one video;
// a post holds up to MAX_POST_ATTACHMENTS.
export function canAddMedia(
  existing: readonly DraftMediaKind[],
  incoming: DraftMediaKind,
  options: { gust?: boolean; max?: number } = {}
): GateVerdict {
  const max = options.max ?? MAX_POST_ATTACHMENTS;
  if (existing.length >= max) {
    return { ok: false, reason: "limit" };
  }
  if (options.gust) {
    return incoming.family === "VIDEO" && existing.length === 0
      ? { ok: true }
      : { ok: false, reason: "gust" };
  }
  if (
    existing.length > 0 &&
    (isExclusive(incoming) || existing.some(isExclusive))
  ) {
    return { ok: false, reason: "exclusive" };
  }
  return { ok: true };
}

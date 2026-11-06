export const STICKER_LIBRARY_MAX_ITEMS = 1000;
export const STICKER_LIBRARY_MAX_BYTES = 500 * 1024 * 1024;
export const STICKER_STATIC_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const STICKER_ANIMATED_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const STICKER_STATIC_MAX_OUTPUT_BYTES = 256 * 1024;
export const STICKER_ANIMATED_MAX_OUTPUT_BYTES = 512 * 1024;
export const STICKER_THUMBNAIL_MAX_OUTPUT_BYTES = 16 * 1024;
export const STICKER_MAX_CANVAS_DIMENSION = 512;
export const STICKER_THUMBNAIL_DIMENSION = 128;
export const STICKER_MAX_DIMENSION = 4096;
export const STICKER_MAX_PIXEL_COUNT = 12_000_000;
export const STICKER_MAX_ANIMATED_FRAME_DIMENSION = 1024;
export const STICKER_MAX_ANIMATION_DURATION_MS = 3000;
export const STICKER_MAX_ANIMATION_FRAMES = 60;
export const STICKER_MAX_CUMULATIVE_FRAME_PIXELS = 32_000_000;
export const STICKER_MAX_CONCURRENT_CONVERSIONS = 2;
export const STICKER_CONVERSION_DAILY_LIMIT = 10;
export const STICKER_CONVERSION_PER_MINUTE_LIMIT = 3;

export const STICKER_STATIC_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const STICKER_ANIMATED_MIME_TYPES = ["image/gif"] as const;

export const STICKER_SUPPORTED_MIME_TYPES = [
  ...STICKER_STATIC_MIME_TYPES,
  ...STICKER_ANIMATED_MIME_TYPES,
] as const;

export type StickerSupportedMimeType =
  (typeof STICKER_SUPPORTED_MIME_TYPES)[number];

export function isStickerSupportedMimeType(
  mimeType: string
): mimeType is StickerSupportedMimeType {
  return (STICKER_SUPPORTED_MIME_TYPES as readonly string[]).includes(
    mimeType.toLowerCase()
  );
}

export function isAnimatedStickerMimeType(mimeType: string): boolean {
  return (STICKER_ANIMATED_MIME_TYPES as readonly string[]).includes(
    mimeType.toLowerCase()
  );
}

export function maxStickerInputBytes(mimeType: string): number {
  return isAnimatedStickerMimeType(mimeType)
    ? STICKER_ANIMATED_MAX_INPUT_BYTES
    : STICKER_STATIC_MAX_INPUT_BYTES;
}

export function maxStickerOutputBytes(animated: boolean): number {
  return animated
    ? STICKER_ANIMATED_MAX_OUTPUT_BYTES
    : STICKER_STATIC_MAX_OUTPUT_BYTES;
}

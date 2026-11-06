import {
  STICKER_ANIMATED_MAX_OUTPUT_BYTES,
  STICKER_MAX_ANIMATION_DURATION_MS,
  STICKER_MAX_ANIMATION_FRAMES,
  STICKER_MAX_ANIMATED_FRAME_DIMENSION,
  STICKER_MAX_CANVAS_DIMENSION,
  STICKER_MAX_CUMULATIVE_FRAME_PIXELS,
  STICKER_MAX_DIMENSION,
  STICKER_MAX_PIXEL_COUNT,
  STICKER_STATIC_MAX_OUTPUT_BYTES,
  STICKER_THUMBNAIL_DIMENSION,
  STICKER_THUMBNAIL_MAX_OUTPUT_BYTES,
  mediaIdentityXmp,
  readMediaIdentityXmp,
} from "@asm/media";
import type { MediaLimits, PlannedImageDerivative } from "@asm/media";
import sharp from "sharp";

import { imageFidelity, passesImageFidelity } from "./fidelity";

// libvips and libaom otherwise size their pools from the host, even when the
// container only has a couple of CPUs. Keep per-job memory/CPU predictable.
sharp.concurrency(2);
sharp.cache({ files: 0, items: 32, memory: 32 });

export interface EncodedStickerDerivatives {
  animated: boolean;
  durationMs: number | null;
  frameCount: number;
  full: Buffer;
  fullHeight: number;
  fullWidth: number;
  thumbnail: Buffer;
  thumbnailHeight: number;
  thumbnailWidth: number;
}

export class StickerSourcePolicyError extends Error {
  override name = "StickerSourcePolicyError";
}

export async function encodeStickerDerivatives(
  bytes: Buffer,
  processingTimeoutMs: number,
  mediaId: string,
  aiGenerated: boolean
): Promise<EncodedStickerDerivatives> {
  const metadata = await sharp(bytes, {
    animated: true,
    failOn: "warning",
    limitInputPixels: STICKER_MAX_PIXEL_COUNT,
  }).metadata();
  const {
    height: pageHeight,
    pageHeight: frameHeight,
    pages,
    width,
  } = metadata;
  const frameCount = pages ?? 1;
  const height = frameHeight ?? pageHeight;
  const animated = frameCount > 1;
  if (
    !width ||
    !height ||
    !Number.isSafeInteger(frameCount) ||
    frameCount < 1
  ) {
    throw new StickerSourcePolicyError("Sticker image dimensions are missing");
  }
  if (animated && metadata.format !== "gif") {
    throw new StickerSourcePolicyError(
      "Only GIF files may be animated stickers"
    );
  }
  if (animated) {
    const delays = metadata.delay;
    if (
      width > STICKER_MAX_ANIMATED_FRAME_DIMENSION ||
      height > STICKER_MAX_ANIMATED_FRAME_DIMENSION ||
      frameCount > STICKER_MAX_ANIMATION_FRAMES ||
      width * height * frameCount > STICKER_MAX_CUMULATIVE_FRAME_PIXELS ||
      !delays ||
      delays.length < frameCount
    ) {
      throw new StickerSourcePolicyError(
        "This GIF exceeds the sticker frame limits"
      );
    }
  } else if (
    width > STICKER_MAX_DIMENSION ||
    height > STICKER_MAX_DIMENSION ||
    width * height > STICKER_MAX_PIXEL_COUNT
  ) {
    throw new StickerSourcePolicyError(
      "This image is too large to turn into a sticker"
    );
  }
  const delay = animated ? (metadata.delay ?? []).slice(0, frameCount) : [];
  const durationMs = animated
    ? delay.reduce((total, frameDelay) => total + frameDelay, 0)
    : null;
  if (
    animated &&
    (!Number.isSafeInteger(durationMs) ||
      durationMs === null ||
      durationMs <= 0 ||
      durationMs > STICKER_MAX_ANIMATION_DURATION_MS)
  ) {
    throw new StickerSourcePolicyError(
      "This GIF is longer than the 3 second sticker limit"
    );
  }

  const inputOptions = {
    animated,
    failOn: "warning" as const,
    limitInputPixels: STICKER_MAX_PIXEL_COUNT,
  };
  const fullHeight = animated
    ? STICKER_MAX_CANVAS_DIMENSION * frameCount
    : STICKER_MAX_CANVAS_DIMENSION;
  const maxOutputBytes = animated
    ? STICKER_ANIMATED_MAX_OUTPUT_BYTES
    : STICKER_STATIC_MAX_OUTPUT_BYTES;
  let full: Buffer | null = null;
  for (const quality of [80, 70, 60]) {
    const output = sharp(bytes, inputOptions)
      .resize(STICKER_MAX_CANVAS_DIMENSION, fullHeight, {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        fit: "contain",
        withoutEnlargement: true,
      })
      .timeout({ seconds: Math.max(1, Math.ceil(processingTimeoutMs / 1000)) });
    output.withXmp(mediaIdentityXmp(mediaId, aiGenerated));
    const encoded = await output
      .webp({
        alphaQuality: 100,
        delay: animated ? delay : undefined,
        effort: 4,
        exact: true,
        loop: animated ? (metadata.loop ?? 0) : undefined,
        quality,
      })
      .toBuffer();
    if (encoded.byteLength <= maxOutputBytes) {
      full = encoded;
      break;
    }
  }
  if (!full) {
    throw new StickerSourcePolicyError(
      "The sticker is still too large after compression. Try a simpler image or shorter GIF."
    );
  }

  let thumbnail: Buffer | null = null;
  for (const quality of [80, 60, 40]) {
    const output = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: STICKER_MAX_PIXEL_COUNT,
      pages: 1,
    }).resize(STICKER_THUMBNAIL_DIMENSION, STICKER_THUMBNAIL_DIMENSION, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: "contain",
      withoutEnlargement: true,
    });
    output.withXmp(mediaIdentityXmp(mediaId, aiGenerated));
    const encoded = await output
      .webp({ alphaQuality: 100, effort: 4, exact: true, quality })
      .toBuffer();
    if (encoded.byteLength <= STICKER_THUMBNAIL_MAX_OUTPUT_BYTES) {
      thumbnail = encoded;
      break;
    }
  }
  if (!thumbnail) {
    throw new StickerSourcePolicyError(
      "A compact sticker preview could not be created"
    );
  }

  const [fullMetadata, thumbnailMetadata] = await Promise.all([
    sharp(full, { animated: true }).metadata(),
    sharp(thumbnail).metadata(),
  ]);
  const fullWidth = fullMetadata.width;
  const fullPageHeight = fullMetadata.pageHeight ?? fullMetadata.height;
  const thumbnailWidth = thumbnailMetadata.width;
  const thumbnailHeight = thumbnailMetadata.height;
  if (
    !fullWidth ||
    !fullPageHeight ||
    !thumbnailWidth ||
    !thumbnailHeight ||
    (animated && (fullMetadata.pages ?? 1) !== frameCount)
  ) {
    throw new StickerSourcePolicyError(
      "The sticker output could not be verified"
    );
  }

  return {
    animated,
    durationMs,
    frameCount,
    full,
    fullHeight: fullPageHeight,
    fullWidth,
    thumbnail,
    thumbnailHeight,
    thumbnailWidth,
  };
}

export async function inspectImage(bytes: Buffer, limits: MediaLimits) {
  const source = sharp(bytes, { limitInputPixels: limits.maxPixelCount });
  const metadata = await source.metadata();
  const rotated = (metadata.orientation ?? 0) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!width || !height) {
    throw new Error("Image dimensions missing");
  }
  const { data, info } = await source
    .clone()
    .autoOrient()
    .resize(32, 32, { fit: "inside" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set<number>();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    colors.add(
      ((data[offset] ?? 0) << 16) |
        ((data[offset + 1] ?? 0) << 8) |
        (data[offset + 2] ?? 0)
    );
  }
  return {
    animated:
      (metadata.pages ?? 1) > 1 &&
      ["gif", "webp", "png", "heif"].includes(metadata.format ?? ""),
    entropy: colors.size / (info.width * info.height),
    format: metadata.format ?? "unknown",
    frames: metadata.pages ?? 1,
    hasAlpha: metadata.hasAlpha,
    height,
    sourceMediaId: readMediaIdentityXmp(metadata.xmp?.toString()),
    width,
  };
}

export async function encodeImageDerivative(
  bytes: Buffer,
  item: PlannedImageDerivative,
  limits: MediaLimits,
  mediaId?: string,
  aiGenerated = false
) {
  const image = sharp(bytes, { limitInputPixels: limits.maxPixelCount })
    .autoOrient()
    .resize(item.width, item.height, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .timeout({
      seconds: Math.max(1, Math.ceil(limits.processingTimeoutMs / 1000)),
    });
  if (mediaId) {
    image.withXmp(mediaIdentityXmp(mediaId, aiGenerated));
  }
  async function acceptable(encoded: Buffer): Promise<boolean> {
    // Bound the comparison footprint independently of source megapixels.
    // Compare after the delivery resize on both sides, using the same kernel.
    const resized = await image
      .clone()
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const reference = await sharp(resized.data, { raw: resized.info })
      .resize({
        fit: "inside",
        height: 512,
        width: 512,
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const output = await sharp(encoded)
      .resize(reference.info.width, reference.info.height, { fit: "fill" })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer();
    return passesImageFidelity(
      imageFidelity(
        reference.data,
        output,
        reference.info.width,
        reference.info.height
      )
    );
  }
  if (item.variant === "avif") {
    const encoded = await image
      .clone()
      .avif({
        chromaSubsampling: "4:4:4",
        effort: 4,
        quality: Math.max(80, item.quality),
      })
      .toBuffer();
    if (!(await acceptable(encoded))) {
      return null;
    }
    return {
      bytes: encoded,
      extension: "avif",
      mimeType: "image/avif",
    };
  }
  if (item.variant === "jpeg") {
    return {
      bytes: await image
        .jpeg({ mozjpeg: true, progressive: true, quality: item.quality })
        .toBuffer(),
      extension: "jpg",
      mimeType: "image/jpeg",
    };
  }
  let encoded = await image
    .clone()
    .webp({
      alphaQuality: 100,
      effort: 4,
      lossless: item.lossless,
      quality: item.quality,
      smartSubsample: true,
    })
    .toBuffer();
  if (!item.lossless && !(await acceptable(encoded))) {
    encoded = await image
      .clone()
      .webp({ effort: 4, lossless: true })
      .toBuffer();
  }
  return {
    bytes: encoded,
    extension: "webp",
    mimeType: "image/webp",
  };
}

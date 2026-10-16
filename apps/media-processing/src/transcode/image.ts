import type { MediaLimits, PlannedImageDerivative } from "@asm/media";
import { mediaIdentityXmp, readMediaIdentityXmp } from "@asm/media";
import sharp from "sharp";

import { imageFidelity, passesImageFidelity } from "./fidelity";

// libvips and libaom otherwise size their pools from the host, even when the
// container only has a couple of CPUs. Keep per-job memory/CPU predictable.
sharp.concurrency(2);
sharp.cache({ files: 0, items: 32, memory: 32 });

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

// Image processing: decode with bomb guards, classify, generate WebP/JPEG
// derivatives per the shared policy, and record a ThumbHash placeholder.
// Engine is Bun.Image (built into Bun 1.4, zero npm deps); AVIF/HEIC are
// OS-backends unavailable on Linux, so delivery formats are WebP + JPEG.

import { prisma } from "@asm/db";
import {
  derivativeKey,
  derivativeName,
  MEDIA_PIPELINE_VERSION,
  planImageDerivatives,
} from "@asm/media";
import type { MediaLimits, PlannedImageDerivative } from "@asm/media";

import { computePerceptualHash, withTimeout } from "../ffmpeg";
import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";

interface DecodedInfo {
  width: number;
  height: number;
  format: string;
}

const PLACEHOLDER_MAX_DIMENSION = 64;

async function uniqueColorFraction(
  image: InstanceType<(typeof Bun)["Image"]>,
  limits: MediaLimits
): Promise<number> {
  // Downscale hard and count distinct colors; flat graphics collapse to a
  // tiny fraction while photos stay near 1.
  const sample = await image.resize(32, 32, { fit: "inside" }).png().buffer();
  const seen = new Set<number>();
  for (let i = 0; i < sample.length - 4; i += 4) {
    const rgb = (sample[i] << 16) | (sample[i + 1] << 8) | (sample[i + 2] ?? 0);
    if (rgb !== 0) {
      seen.add(rgb);
    }
  }
  void limits;
  return Math.min(1, seen.size / 1024);
}

function hasAlphaChannel(buffer: Buffer, format: string): boolean {
  // Cheap structural check: PNG color type 6/4 carry alpha; WebP ALPH chunk.
  if (format === "png") {
    return buffer[25] === 6 || buffer[25] === 4;
  }
  if (format === "webp") {
    return buffer.includes(Buffer.from("ALPH"));
  }
  return false;
}

function countFrames(buffer: Buffer): number {
  // GIF frame count via the 0x21F9 graphic-control extension; other formats
  // are treated as single-frame for planning purposes.
  let frames = 0;
  let offset = 0;
  while (
    (offset = buffer.indexOf(Buffer.from([0x21, 0xf9, 0x04]), offset)) !== -1
  ) {
    frames += 1;
    offset += 3;
    if (frames > 512) {
      break;
    }
  }
  return Math.max(frames, 1);
}

// True when the uploaded bytes are themselves a lossless encoding, so an
// original-resolution derivative can stay bit-exact instead of inheriting a
// generational lossy re-encode. PNG and GIF are lossless by definition; WebP
// is only lossless when its image payload is the VP8L (lossless) bitstream -
// VP8 marks lossy WebP, which must not be "upgraded" to a bloated lossless
// re-encode.
function isLosslessSourceFormat(buffer: Buffer, format: string): boolean {
  if (format === "png" || format === "gif") {
    return true;
  }
  if (format === "webp") {
    return buffer.includes(Buffer.from("VP8L"));
  }
  return false;
}

export async function processMediaImage(input: {
  /** Receives every object key promoted to storage, for failure rollback. */
  mediaId: string;
  sourcePath: string;
  uploadedKeys?: string[];
  publishedKey: string;
  limits: MediaLimits;
}): Promise<void> {
  await withSpan(
    "job.media-process-image",
    async () => {
      // Hosts without an OS codec for the source format (AVIF/HEIC/TIFF)
      // can never produce derivatives; retrying a permanently impossible
      // job just burns CPU. That case is caught below and published
      // derivative-less - the serving route falls back to the original.
      try {
        const s3 = getS3();
        const file = Bun.file(input.sourcePath);
        const bytes = Buffer.from(await file.arrayBuffer());

        // Header-only metadata first; maxPixels guards the actual decode.
        const probeImage = new Bun.Image(bytes, {
          maxPixels: input.limits.maxPixelCount,
        });
        const meta = (await probeImage.metadata()) as DecodedInfo;

        const decodeImage = new Bun.Image(bytes, {
          autoOrient: true,
          maxPixels: input.limits.maxPixelCount,
        });

        const animated = meta.format === "gif" && countFrames(bytes) > 1;
        const alpha = hasAlphaChannel(bytes, meta.format);

        // Animated sources keep their original bytes in motion; static posters
        // below still come out of the same decode.
        const entropy = animated
          ? 0.9
          : await uniqueColorFraction(decodeImage, input.limits);

        const plan = planImageDerivatives({
          colorEntropy: entropy,
          hasAlpha: alpha,
          height: meta.height,
          isAnimated: animated,
          isLosslessSource:
            !animated && isLosslessSourceFormat(bytes, meta.format),
          width: meta.width,
        });

        // ThumbHash LQIP stored on the row (~500 bytes, no extra object).
        const blurDataUrl = await new Bun.Image(bytes, {
          maxPixels: input.limits.maxPixelCount,
        })
          .resize(
            Math.min(meta.width, PLACEHOLDER_MAX_DIMENSION),
            Math.min(meta.height, PLACEHOLDER_MAX_DIMENSION),
            { fit: "inside" }
          )
          .placeholder();

        const derivativesToInsert: {
          kind: string;
          key: string;
          mimeType: string;
          pipelineVersion: string;
          sizeBytes: number;
          variant: string;
        }[] = [];

        for (const item of plan) {
          const encodeStart = performance.now();
          const encoded = await encodeDerivative(
            decodeImage,
            item,
            input.limits.processingTimeoutMs
          );
          if (!encoded) {
            continue;
          }
          const name = derivativeName(
            item.kind,
            item.variant,
            encoded.extension
          );
          const key = derivativeKey(
            MEDIA_PIPELINE_VERSION,
            input.mediaId,
            name
          );
          await s3.write(key, encoded.bytes);
          input.uploadedKeys?.push(key);
          derivativesToInsert.push({
            key,
            kind: item.kind,
            mimeType: encoded.mimeType,
            pipelineVersion: MEDIA_PIPELINE_VERSION,
            sizeBytes: encoded.bytes.byteLength,
            variant: item.variant,
          });
          const encodeMs = Math.round(performance.now() - encodeStart);
          if (encodeMs > 5000) {
            mediaLogger.warn(
              {
                encodeMs,
                kind: item.kind,
                mediaId: input.mediaId,
                sizeBytes: encoded.bytes.byteLength,
                variant: item.variant,
              },
              "slow image encode"
            );
          }
        }

        await prisma.mediaDerivative.createMany({
          data: derivativesToInsert.map((item) => ({
            ...item,
            mediaId: input.mediaId,
          })),
          skipDuplicates: true,
        });

        const existing = await prisma.media.findUnique({
          select: { techMetadata: true },
          where: { id: input.mediaId },
        });
        const baseTech =
          existing?.techMetadata &&
          typeof existing.techMetadata === "object" &&
          !Array.isArray(existing.techMetadata)
            ? (existing.techMetadata as Record<string, unknown>)
            : {};

        const aspectRatio = Number((meta.width / meta.height).toFixed(4));
        const hasIccProfile =
          bytes.includes(Buffer.from("ICC_PROFILE")) ||
          bytes.includes(Buffer.from("iCCP"));
        const orientation =
          (baseTech.orientation as number | undefined) ??
          (baseTech.Orientation as number | undefined);

        const computedPhash =
          (await computePerceptualHash(
            input.sourcePath,
            0,
            input.limits.scanTimeoutMs
          ).catch(() => null)) || null;

        await prisma.media.update({
          data: {
            blurDataUrl,
            phash: computedPhash,
            techMetadata: {
              ...baseTech,
              animated,
              aspectRatio,
              bitDepth: meta.format === "png" ? 8 : undefined,
              colorEntropy: Number(entropy.toFixed(3)),
              colorSpace: meta.format === "png" ? "sRGB" : undefined,
              format: meta.format,
              frameCount: animated ? countFrames(bytes) : 1,
              hasAlpha: alpha,
              hasIccProfile,
              height: meta.height,
              orientation:
                orientation && orientation > 1 ? orientation : undefined,
              width: meta.width,
            } as object,
          },
          where: { id: input.mediaId },
        });

        // Re-share attribution — bounded phash scan, single-hop, idempotent via reShareChecked.
        if (computedPhash) {
          try {
            const mediaOwner = await prisma.media.findUnique({
              select: { userId: true },
              where: { id: input.mediaId },
            });
            const { attributeReshare } = await import("../watermark/reshare");
            await attributeReshare(
              input.mediaId,
              computedPhash,
              mediaOwner?.userId ?? null
            );
          } catch (error) {
            mediaLogger.warn(
              { error: String(error), mediaId: input.mediaId },
              "re-share attribution failed"
            );
          }
        }

        mediaLogger.info(
          { derivatives: derivativesToInsert.length, mediaId: input.mediaId },
          "image derivatives generated"
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("format not supported")
        ) {
          mediaLogger.warn(
            { mediaId: input.mediaId },
            "image codec unavailable on this host; publishing without derivatives"
          );
          return;
        }
        throw error;
      }
    },
    { "media.id": input.mediaId }
  );
}

interface EncodedDerivative {
  bytes: Buffer;
  extension: string;
  mimeType: string;
}

type BunImagePipeline = ReturnType<
  InstanceType<(typeof Bun)["Image"]>["resize"]
>;

async function encodeDerivative(
  source: BunImagePipeline,
  item: PlannedImageDerivative,
  timeoutMs: number
): Promise<EncodedDerivative | null> {
  const scaled = source.resize(item.width, item.height, {
    filter: "lanczos3",
    fit: "fill",
    withoutEnlargement: true,
  });

  // Bounded encode: Bun.Image has no native deadline, so a pathological
  // source that slips past the pixel guards must not pin the worker slot.
  // On timeout the encode is abandoned and the derivative skipped - the
  // serving route falls back to the published original.
  if (item.variant === "webp") {
    const bytes = await withTimeout(
      scaled
        .webp({ lossless: item.lossless === true, quality: item.quality })
        .buffer(),
      timeoutMs,
      `webp encode timed out (${item.kind}/${item.variant})`
    );
    return {
      bytes: Buffer.from(bytes),
      extension: "webp",
      mimeType: "image/webp",
    };
  }
  if (item.variant === "jpeg") {
    const bytes = await withTimeout(
      scaled.jpeg({ progressive: true, quality: item.quality }).buffer(),
      timeoutMs,
      `jpeg encode timed out (${item.kind}/${item.variant})`
    );
    return {
      bytes: Buffer.from(bytes),
      extension: "jpg",
      mimeType: "image/jpeg",
    };
  }
  // Palette PNG for flat graphics/screenshots: 3-5x smaller than WebP for
  // low-color content, and indexed mode preserves sharp edges. Only wired
  // when the planner sets palette:true (graphic q88).
  if ((item as { palette?: boolean }).palette) {
    try {
      const bytes = await withTimeout(
        scaled.png({ palette: true }).buffer(),
        timeoutMs,
        `png palette encode timed out (${item.kind}/${item.variant})`
      );
      return {
        bytes: Buffer.from(bytes as unknown as Uint8Array),
        extension: "png",
        mimeType: "image/png",
      };
    } catch {
      // fall through to WebP already emitted for this rung — palette is
      // bonus, not required, so a missing codec just skips the PNG copy.
    }
  }
  return null;
}

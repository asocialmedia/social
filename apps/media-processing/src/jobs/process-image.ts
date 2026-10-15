// Image processing: guarded libvips decode and WebP/AVIF/JPEG delivery.
// Originals remain the recovery and download source.

import { prisma } from "@asm/db";
import {
  derivativeKey,
  derivativeName,
  MEDIA_PIPELINE_VERSION,
  planImageDerivatives,
} from "@asm/media";
import type { MediaLimits } from "@asm/media";

import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";
import { computePerceptualHash } from "../transcode/ffmpeg";
import { inspectImage, encodeImageDerivative } from "../transcode/image";
import { persistMediaDerivatives } from "./derivatives";

const PLACEHOLDER_MAX_DIMENSION = 64;

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
  // Isolated output prefix; a failed upgrade cannot overwrite live derivatives.
  storageId?: string;
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
        const provenance = await prisma.orm.public.PostMedia.select(
          "aiGenerated",
          "detectedMime",
          "mimeType",
          "techMetadata"
        )
          .where({ id: input.mediaId })
          .first();

        const meta = await inspectImage(bytes, input.limits);
        const { animated } = meta;
        const alpha = meta.hasAlpha;
        const { entropy } = meta;

        const plan = animated
          ? []
          : planImageDerivatives({
              colorEntropy: entropy,
              hasAlpha: alpha,
              height: meta.height,
              isAnimated: animated,
              isLosslessSource:
                !animated && isLosslessSourceFormat(bytes, meta.format),
              width: meta.width,
            });

        // ThumbHash LQIP stored on the row (~500 bytes, no extra object).
        const placeholder = await encodeImageDerivative(
          bytes,
          {
            height: Math.min(meta.height, PLACEHOLDER_MAX_DIMENSION),
            kind: "thumb",
            quality: 80,
            variant: "webp",
            width: Math.min(meta.width, PLACEHOLDER_MAX_DIMENSION),
          },
          input.limits
        );
        if (!placeholder) {
          throw new Error("Image placeholder encode failed");
        }
        const blurDataUrl = await new Bun.Image(placeholder.bytes, {
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
          width: number;
          height: number;
        }[] = [];

        const orderedPlan = [
          ...plan.filter((item) => item.variant !== "avif"),
          ...plan.filter((item) => item.variant === "avif"),
        ];
        for (const item of orderedPlan) {
          const encodeStart = performance.now();
          const encoded = await encodeImageDerivative(
            bytes,
            item,
            input.limits,
            input.mediaId,
            provenance?.aiGenerated === true
          );
          if (!encoded) {
            continue;
          }
          if (
            item.variant === "avif" &&
            encoded.bytes.byteLength >= bytes.byteLength
          ) {
            continue;
          }
          const name = derivativeName(
            item.kind,
            item.variant,
            encoded.extension
          );
          const key = derivativeKey(
            MEDIA_PIPELINE_VERSION,
            input.storageId ?? input.mediaId,
            name
          );
          const smaller = encoded.bytes.byteLength < bytes.byteLength;
          if (smaller) {
            await s3.write(key, encoded.bytes);
            input.uploadedKeys?.push(key);
          }
          // A difficult source can beat even a resized encode. Reuse its
          // already-scrubbed bytes rather than transfer a larger derivative.
          const derivative = {
            height: smaller ? item.height : meta.height,
            key: smaller ? key : input.publishedKey,
            kind: item.kind,
            mimeType: smaller
              ? encoded.mimeType
              : (provenance?.detectedMime ??
                provenance?.mimeType ??
                encoded.mimeType),
            pipelineVersion: MEDIA_PIPELINE_VERSION,
            sizeBytes: smaller ? encoded.bytes.byteLength : bytes.byteLength,
            variant: item.variant,
            width: smaller ? item.width : meta.width,
          };
          derivativesToInsert.push(derivative);
          // Make compatible rungs usable before the heavier modern encodes.
          await prisma.transaction((transaction) =>
            persistMediaDerivatives(transaction, input.mediaId, [derivative])
          );
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

        await prisma.transaction((transaction) =>
          persistMediaDerivatives(
            transaction,
            input.mediaId,
            derivativesToInsert
          )
        );

        const existing = await prisma.orm.public.PostMedia.select(
          "techMetadata"
        )
          .where({ id: input.mediaId })
          .first();
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

        await prisma.orm.public.PostMedia.where({ id: input.mediaId }).update({
          blurDataUrl,
          phash: computedPhash,
          techMetadata: {
            ...baseTech,
            animated,
            aspectRatio,
            ...(meta.format === "png" ? { bitDepth: 8 } : {}),
            colorEntropy: Number(entropy.toFixed(3)),
            ...(meta.format === "png" ? { colorSpace: "sRGB" } : {}),
            format: meta.format,
            frameCount: meta.frames,
            hasAlpha: alpha,
            hasIccProfile,
            height: meta.height,
            ...(orientation && orientation > 1 ? { orientation } : {}),
            width: meta.width,
          },
        });

        // Re-share attribution — bounded phash scan, single-hop, idempotent via reShareChecked.
        if (computedPhash) {
          try {
            const mediaOwner = await prisma.orm.public.PostMedia.select(
              "userId"
            )
              .where({ id: input.mediaId })
              .first();
            const { attributeReshare } = await import("../watermark/reshare");
            await attributeReshare(
              input.mediaId,
              computedPhash,
              mediaOwner?.userId ?? null,
              meta.sourceMediaId ??
                (provenance?.techMetadata &&
                typeof provenance.techMetadata === "object" &&
                "sourceMediaId" in provenance.techMetadata &&
                typeof provenance.techMetadata.sourceMediaId === "string"
                  ? provenance.techMetadata.sourceMediaId
                  : undefined)
            );
          } catch (error) {
            mediaLogger.warn(
              { error: String(error), mediaId: input.mediaId },
              "re-share attribution failed"
            );
          }
        }

        // Profile media (avatar/banner) promotion: once derivatives are
        // committed, a linked static image swaps its serving key to the best
        // derivative while preserving the published original. Animated GIFs are
        // skipped inside the helper — motion lives only in the original.
        // Best-effort: promotion failure must not fail the process job.
        if (derivativesToInsert.length > 0) {
          try {
            const { promoteCommunityDerivative, promoteProfileDerivative } =
              await import("@asm/db");
            await promoteProfileDerivative(input.mediaId, "avatar");
            await promoteProfileDerivative(input.mediaId, "banner");
            await promoteCommunityDerivative(input.mediaId, "avatar");
            await promoteCommunityDerivative(input.mediaId, "banner");
          } catch (error) {
            mediaLogger.warn(
              { error: String(error), mediaId: input.mediaId },
              "profile media promotion failed"
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

// Video processing: probe, scene-aware poster, progressive MP4 for social
// clips, HLS ladder for long-form. Encoding is software x264 (VPS reality);
// hardware acceleration stays a future opt-in.

import { prisma } from "@asm/db";
import {
  derivativeKey,
  derivativeName,
  MEDIA_PIPELINE_VERSION,
  planVideoOutputs,
} from "@asm/media";
import type { MediaLimits } from "@asm/media";

import {
  enforceDecoderLimits,
  extractGrayPixels,
  runFfmpeg,
  withTimeout,
  FfmpegError,
  probeMedia,
} from "../ffmpeg";
import type { ProbeResult } from "../ffmpeg";
import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";

const PROGRESSIVE_MAX_HEIGHT = 1080;

export async function processMediaVideo(input: {
  /** Receives every object key promoted to storage, for failure rollback. */
  mediaId: string;
  sourcePath: string;
  uploadedKeys?: string[];
  limits: MediaLimits;
}): Promise<void> {
  await withSpan(
    "job.media-process-video",
    async () => {
      const s3 = getS3();
      // Bounded probe: a malformed container that hangs ffprobe must not
      // pin a worker slot until BullMQ retries run out.
      const probe: ProbeResult = await withTimeout(
        probeMedia(input.sourcePath),
        input.limits.processingTimeoutMs,
        "video probe timed out"
      );

      if (!probe.video) {
        throw new FfmpegError("video stream missing despite scan pass");
      }

      // Decoder ceilings before any encode work: over-limit streams are a
      // policy rejection, not a transient failure - let the error bubble so
      // the failed handler marks the row after retries exhaust.
      enforceDecoderLimits(probe, {
        maxBitrateKbps: input.limits.maxBitrateKbps,
        maxDimension: input.limits.maxDimension,
        maxFps: input.limits.maxFps,
        maxVideoDurationSec: input.limits.maxVideoDurationSec,
      });

      // Rotation metadata is applied physically so every derivative is
      // upright without client-side handling.
      const rotationFilter =
        probe.video.rotation === 0
          ? []
          : [`-display_rotation`, String(-probe.video.rotation)];

      const plan = planVideoOutputs({
        durationSec: probe.durationSec,
        srcHeight: probe.video.height,
      });

      const derivatives: PrismaDerivativeInsert[] = [];

      // 1. Scene-aware poster: sample candidate frames across the timeline,
      // score by luminance variance (reject black/solid frames), pick best.
      // This derivative is COMMITTED IMMEDIATELY after encoding (upload +
      // createMany right here) rather than batched with the transcodes below:
      // the row already reads READY at this point, so feed thumbnails hit
      // /api/media/{id}?thumb=1 in the seconds between publish and the end
      // of the MP4/HLS pipeline - deferring the poster row to the final
      // insert made every such request serve the gray SVG placeholder for
      // the whole encode, and browsers cached that placeholder for 60s.
      const posterPath = `${input.sourcePath}-poster.jpg`;
      const posterSeek = await pickPosterTimestamp(input.sourcePath, probe);
      await runFfmpeg(
        [
          ...rotationFilter,
          "-ss",
          String(posterSeek),
          "-i",
          input.sourcePath,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          posterPath,
        ],
        input.limits.processingTimeoutMs / 2
      );
      const posterKey = derivativeKey(
        MEDIA_PIPELINE_VERSION,
        input.mediaId,
        derivativeName("poster", "default", "jpg")
      );
      await s3.write(posterKey, Bun.file(posterPath));
      input.uploadedKeys?.push(posterKey);

      const blurDataUrl = await new Bun.Image(
        await Bun.file(posterPath).arrayBuffer(),
        {
          maxPixels: input.limits.maxPixelCount,
        }
      ).placeholder();

      // Publish the poster + LQIP before the expensive transcodes: the
      // serving route can then hand feed cards the real frame seconds
      // earlier, and a mid-MP4 crash still leaves the thumbnail live.
      // skipDuplicates keeps a retry idempotent (unique [mediaId,kind,variant]).
      await prisma.mediaDerivative.createMany({
        data: [
          {
            key: posterKey,
            kind: "poster",
            mediaId: input.mediaId,
            mimeType: "image/jpeg",
            pipelineVersion: MEDIA_PIPELINE_VERSION,
            variant: "default",
          },
        ],
        skipDuplicates: true,
      });
      await prisma.media.update({
        data: { blurDataUrl },
        where: { id: input.mediaId },
      });
      const posterRow = {
        key: posterKey,
        kind: "poster",
        mimeType: "image/jpeg",
        pipelineVersion: MEDIA_PIPELINE_VERSION,
        variant: "default",
      } as const;
      derivatives.push(posterRow);

      // 2. Progressive MP4 (social clips): H.264 High + AAC, faststart.
      // CRF 20 keeps re-encoded clips visually transparent next to the
      // original upload; CRF 23 reads as noticeably softer on phones.
      if (
        plan.progressiveMp4 &&
        probe.video.height <= PROGRESSIVE_MAX_HEIGHT &&
        !plan.hls
      ) {
        const mp4Path = `${input.sourcePath}.mp4`;
        await runFfmpeg(
          [
            ...rotationFilter,
            "-i",
            input.sourcePath,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-maxrate",
            `${Math.min(probe.formatBitrateKbps || 5000, 6000)}k`,
            "-bufsize",
            "12000k",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-map_metadata",
            "-1",
            mp4Path,
          ],
          input.limits.processingTimeoutMs
        );
        const mp4Key = derivativeKey(
          MEDIA_PIPELINE_VERSION,
          input.mediaId,
          derivativeName("mp4", "h264", "mp4")
        );
        await s3.write(mp4Key, Bun.file(mp4Path));
        input.uploadedKeys?.push(mp4Key);
        derivatives.push({
          key: mp4Key,
          kind: "mp4",
          mimeType: "video/mp4",
          pipelineVersion: MEDIA_PIPELINE_VERSION,
          sizeBytes: Bun.file(mp4Path).size,
          variant: "h264",
        });
      }

      // 3. HLS ladder for long-form: fMP4 segments per planned rung.
      if (plan.hls) {
        const hlsDir = `${input.sourcePath}-hls`;
        await Bun.$`mkdir -p ${hlsDir}`.quiet();
        const rungs = plan.hlsLadder;
        for (let index = 0; index < rungs.length; index += 1) {
          const rung = rungs[index];
          if (!rung) {
            continue;
          }
          const variantPath = `${hlsDir}/${rung.variant}.m3u8`;
          const initSegment = `${hlsDir}/init-${rung.variant}.mp4`;
          const segmentPattern = `${hlsDir}/seg-${rung.variant}-%04d.m4s`;
          await runFfmpeg(
            [
              ...rotationFilter,
              "-i",
              input.sourcePath,
              "-vf",
              `scale=-2:${rung.height}`,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-sc_threshold",
              "0",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-b:a",
              `${rung.audioKbps}k`,
              "-map_metadata",
              "-1",
              "-f",
              "hls",
              "-hls_time",
              "6",
              "-hls_playlist_type",
              "vod",
              "-hls_segment_type",
              "fmp4",
              "-hls_fmp4_init_filename",
              `init-${rung.variant}.mp4`,
              "-hls_segment_filename",
              segmentPattern,
              variantPath,
            ],
            input.limits.processingTimeoutMs
          );
          void initSegment;

          // Master playlist on the last pass. RESOLUTION must be concrete
          // pixels: compute the even-aligned width from the source aspect.
          if (index === rungs.length - 1 && probe.video) {
            const aspect =
              probe.video.width > 0 && probe.video.height > 0
                ? probe.video.width / probe.video.height
                : 16 / 9;
            const masterLines = [
              "#EXTM3U",
              "#EXT-X-VERSION:7",
              ...rungs.map((entry) => {
                const width = Math.round((entry.height * aspect) / 2) * 2;
                return `#EXT-X-STREAM-INF:BANDWIDTH=${(entry.videoKbps + entry.audioKbps) * 1000},RESOLUTION=${width}x${entry.height}\n${entry.variant}.m3u8`;
              }),
            ].join("\n");
            await Bun.write(`${hlsDir}/master.m3u8`, `${masterLines}\n`);
          }
        }

        // Upload every playlist/segment under the deterministic prefix.
        for (const entry of await Array.fromAsync(
          new Bun.Glob("**/*").scan({ cwd: hlsDir })
        )) {
          const localPath = `${hlsDir}/${entry}`;
          const key = derivativeKey(
            MEDIA_PIPELINE_VERSION,
            input.mediaId,
            `hls/${entry}`
          );
          await s3.write(key, Bun.file(localPath));
          input.uploadedKeys?.push(key);
          if (!derivatives.some((d) => d.kind === "hls")) {
            derivatives.push({
              key: derivativeKey(
                MEDIA_PIPELINE_VERSION,
                input.mediaId,
                "hls/master.m3u8"
              ),
              kind: "hls",
              mimeType: "application/vnd.apple.mpegurl",
              pipelineVersion: MEDIA_PIPELINE_VERSION,
              variant: "master",
            });
          }
        }
      }

      await prisma.mediaDerivative.createMany({
        data: derivatives.map((item) => ({ ...item, mediaId: input.mediaId })),
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

      await prisma.media.update({
        data: {
          blurDataUrl,
          hasHls: plan.hls,
          height: probe.video.height,
          phash: await computePosterHash(input.sourcePath, probe),
          techMetadata: {
            ...baseTech,
            audio: probe.audio ?? undefined,
            bitrateKbps: probe.formatBitrateKbps,
            colorSpace: probe.video.colorSpace ?? undefined,
            colorTransfer: probe.video.colorTransfer ?? undefined,
            durationSec: probe.durationSec,
            fps: probe.video.fps,
            frameRateMode: probe.video.frameRateMode,
            hdr: probe.video.colorTransfer === "smpte2084",
            pixelFormat: probe.video.pixelFormat,
            videoBitrateKbps: probe.video.bitrateKbps,
            videoCodec: probe.video.codec,
          } as object,
          width: probe.video.width,
        },
        where: { id: input.mediaId },
      });

      mediaLogger.info(
        { derivatives: derivatives.length, mediaId: input.mediaId },
        "video derivatives generated"
      );
    },
    { "media.id": input.mediaId }
  );
}

interface PrismaDerivativeInsert {
  kind: string;
  key: string;
  mimeType: string;
  pipelineVersion: string;
  sizeBytes?: number;
  variant: string;
}

async function computePosterHash(
  sourcePath: string,
  probe: ProbeResult
): Promise<string> {
  const pixels = await extractGrayPixels(
    sourcePath,
    Math.max(0, probe.durationSec * 0.25),
    9,
    8,
    30_000
  ).catch(() => null);
  if (!pixels) {
    return "";
  }
  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (pixels[y * 9 + x] > pixels[y * 9 + x + 1]) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }
  return hash.toString(16).padStart(16, "0");
}

// Samples up to five timestamps and picks the one with highest luminance
// spread; flat/black openings lose to contentful frames.
async function pickPosterTimestamp(
  sourcePath: string,
  probe: ProbeResult
): Promise<number> {
  if (probe.durationSec <= 1) {
    return 0;
  }
  const candidates = [0.1, 0.25, 0.5, 0.75]
    .map((fraction) =>
      Math.min(probe.durationSec - 0.5, probe.durationSec * fraction)
    )
    .filter((t) => t >= 0);

  let bestTimestamp = 0;
  let bestScore = -1;
  for (const timestamp of candidates.length > 0 ? candidates : [0]) {
    try {
      const pixels = await extractGrayPixels(
        sourcePath,
        timestamp,
        16,
        9,
        15_000
      );
      let min = 255;
      let max = 0;
      let sum = 0;
      for (const value of pixels) {
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
      }
      const mean = sum / pixels.length;
      const score = (max - min) * 0.6 + mean * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestTimestamp = timestamp;
      }
    } catch {
      continue;
    }
  }
  return Number(bestTimestamp.toFixed(2));
}

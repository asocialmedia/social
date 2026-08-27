// Audio processing: loudness-normalized Opus (primary) + AAC (fallback),
// waveform peaks for players, cover-art extraction.

import { prisma } from "@asm/db";
import {
  derivativeKey,
  derivativeName,
  MEDIA_PIPELINE_VERSION,
  AUDIO_AAC_KBPS,
  AUDIO_OPUS_KBPS,
  AUDIO_TARGET_LUFS,
} from "@asm/media";
import type { MediaLimits } from "@asm/media";

import {
  enforceDecoderLimits,
  runFfmpeg,
  withTimeout,
  probeMedia,
} from "../ffmpeg";
import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";

const WAVEFORM_POINTS = 200;

export async function processMediaAudio(input: {
  /** Receives every object key promoted to storage, for failure rollback. */
  mediaId: string;
  sourcePath: string;
  uploadedKeys?: string[];
  limits: MediaLimits;
}): Promise<void> {
  await withSpan(
    "job.media-process-audio",
    async () => {
      const s3 = getS3();
      // Bounded probe: a malformed container that hangs ffprobe must not
      // pin a worker slot until BullMQ retries run out.
      const probe = await withTimeout(
        probeMedia(input.sourcePath),
        input.limits.processingTimeoutMs,
        "audio probe timed out"
      );
      // Duration/bitrate ceilings before any transcode; the guard skips its
      // video-stream checks because probe.video is null for audio.
      enforceDecoderLimits(probe, {
        maxBitrateKbps: input.limits.maxBitrateKbps,
        maxDimension: Number.MAX_SAFE_INTEGER,
        maxFps: Number.MAX_SAFE_INTEGER,
        maxVideoDurationSec: input.limits.maxAudioDurationSec,
      });
      const derivatives: {
        durationMs?: number;
        key: string;
        kind: string;
        mimeType: string;
        pipelineVersion: string;
        sizeBytes?: number;
        variant: string;
      }[] = [];

      // Single-pass EBU R128 loudnorm keeps every track at a consistent
      // perceived loudness; two-pass accuracy is not worth the double decode.
      const loudnormArgs = [
        "-af",
        `loudnorm=I=${AUDIO_TARGET_LUFS}:TP=-1.5:LRA=11`,
      ];

      // Opus in a WebM container: the modern default.
      const opusPath = `${input.sourcePath}.opus.webm`;
      await runFfmpeg(
        [
          "-i",
          input.sourcePath,
          ...loudnormArgs,
          "-c:a",
          "libopus",
          "-b:a",
          `${AUDIO_OPUS_KBPS}k`,
          "-map_metadata",
          "-1",
          "-vn",
          opusPath,
        ],
        input.limits.processingTimeoutMs
      );
      const opusKey = derivativeKey(
        MEDIA_PIPELINE_VERSION,
        input.mediaId,
        derivativeName("audio", "opus", "webm")
      );
      await s3.write(opusKey, Bun.file(opusPath));
      input.uploadedKeys?.push(opusKey);
      derivatives.push({
        durationMs: Math.round(probe.durationSec * 1000),
        key: opusKey,
        kind: "audio",
        mimeType: "audio/webm",
        pipelineVersion: MEDIA_PIPELINE_VERSION,
        sizeBytes: Bun.file(opusPath).size,
        variant: "opus",
      });

      // AAC fallback for Safari/older WebViews.
      const aacPath = `${input.sourcePath}.m4a`;
      await runFfmpeg(
        [
          "-i",
          input.sourcePath,
          ...loudnormArgs,
          "-c:a",
          "aac",
          "-b:a",
          `${AUDIO_AAC_KBPS}k`,
          "-map_metadata",
          "-1",
          "-vn",
          aacPath,
        ],
        input.limits.processingTimeoutMs
      );
      const aacKey = derivativeKey(
        MEDIA_PIPELINE_VERSION,
        input.mediaId,
        derivativeName("audio", "aac", "m4a")
      );
      await s3.write(aacKey, Bun.file(aacPath));
      input.uploadedKeys?.push(aacKey);
      derivatives.push({
        durationMs: Math.round(probe.durationSec * 1000),
        key: aacKey,
        kind: "audio",
        mimeType: "audio/mp4",
        pipelineVersion: MEDIA_PIPELINE_VERSION,
        sizeBytes: Bun.file(aacPath).size,
        variant: "aac",
      });

      // Embedded cover art, if present.
      try {
        const coverPath = `${input.sourcePath}-cover.jpg`;
        let extractedCover = false;
        await runFfmpeg(
          [
            "-i",
            input.sourcePath,
            "-an",
            "-frames:v",
            "1",
            "-map_metadata",
            "-1",
            "-q:v",
            "4",
            coverPath,
          ],
          30_000
        ).then(() => {
          extractedCover = true;
        });
        if (extractedCover) {
          const coverKey = derivativeKey(
            MEDIA_PIPELINE_VERSION,
            input.mediaId,
            derivativeName("cover", "default", "jpg")
          );
          await s3.write(coverKey, Bun.file(coverPath));
          input.uploadedKeys?.push(coverKey);
          derivatives.push({
            key: coverKey,
            kind: "cover",
            mimeType: "image/jpeg",
            pipelineVersion: MEDIA_PIPELINE_VERSION,
            variant: "default",
          });
        }
      } catch {
        // Cover art is optional; absence is not a failure.
      }

      // Waveform peaks: decode mono 8kHz PCM and bucket maxima.
      const peaks = await extractWaveformPeaks(
        input.sourcePath,
        probe.durationSec
      );
      const waveKey = derivativeKey(
        MEDIA_PIPELINE_VERSION,
        input.mediaId,
        derivativeName("wave", "peaks", "json")
      );
      const waveLocalPath = `${input.sourcePath}-peaks.json`;
      await Bun.write(
        waveLocalPath,
        JSON.stringify({
          durationMs: Math.round(probe.durationSec * 1000),
          peaks,
        })
      );
      await s3.write(waveKey, Bun.file(waveLocalPath));
      input.uploadedKeys?.push(waveKey);
      derivatives.push({
        key: waveKey,
        kind: "wave",
        mimeType: "application/json",
        pipelineVersion: MEDIA_PIPELINE_VERSION,
        variant: "peaks",
      });

      await prisma.mediaDerivative.createMany({
        data: derivatives.map((item) => ({ ...item, mediaId: input.mediaId })),
        skipDuplicates: true,
      });

      const hasCoverArt = derivatives.some((d) => d.kind === "cover");
      const audioFprint =
        (await import("../ffmpeg").then((mod) =>
          mod.computeAudioFingerprint(input.sourcePath, probe.durationSec, input.limits.scanTimeoutMs)
        ).catch(() => null)) || null;

      if (probe.audio) {
        await prisma.media.update({
          data: {
            phash: audioFprint,
            techMetadata: {
              audio: probe.audio,
              container: probe.container,
              durationSec: probe.durationSec,
              hasCoverArt,
              targetLufs: AUDIO_TARGET_LUFS,
            },
          },
          where: { id: input.mediaId },
        });
      } else if (hasCoverArt || audioFprint) {
        await prisma.media.update({
          data: {
            ...(audioFprint ? { phash: audioFprint } : {}),
            techMetadata: {
              container: probe.container,
              durationSec: probe.durationSec,
              hasCoverArt,
            } as object,
          },
          where: { id: input.mediaId },
        });
      } else if (audioFprint) {
        await prisma.media.update({
          data: { phash: audioFprint },
          where: { id: input.mediaId },
        });
      }

      // Re-share attribution for audio — same bounded phash scan as images, now with 128-bit fingerprint
      if (audioFprint) {
        try {
          const mediaOwner = await prisma.media.findUnique({
            select: { userId: true },
            where: { id: input.mediaId },
          });
          const { attributeReshare } = await import("../watermark/reshare");
          await attributeReshare(input.mediaId, audioFprint, mediaOwner?.userId ?? null);
        } catch (error) {
          mediaLogger.warn(
            { error: String(error), mediaId: input.mediaId },
            "re-share attribution failed"
          );
        }
      }

      mediaLogger.info(
        { derivatives: derivatives.length, mediaId: input.mediaId },
        "audio derivatives generated"
      );
    },
    { "media.id": input.mediaId }
  );
}

async function extractWaveformPeaks(
  sourcePath: string,
  durationSec: number,
  timeoutMs = 30_000
): Promise<number[]> {
  const sampleRate = 8000;
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "-vcodec",
      "pcm_s16le",
      "pipe:1",
    ],
    { stderr: "ignore", stdin: "ignore", stdout: "pipe" }
  );

  const timeout = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // Already exited.
    }
  }, timeoutMs);

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    await proc.exited;
  } finally {
    clearTimeout(timeout);
  }

  const samples = new Int16Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength >> 1
  );
  const totalSamples = samples.length;
  if (totalSamples === 0) {
    return [];
  }
  const bucketSize = Math.max(1, Math.floor(totalSamples / WAVEFORM_POINTS));
  const peaks: number[] = [];
  for (
    let start = 0;
    start < totalSamples && peaks.length < WAVEFORM_POINTS;
    start += bucketSize
  ) {
    let peak = 0;
    const end = Math.min(start + bucketSize, totalSamples);
    for (let i = start; i < end; i += 16) {
      const value = Math.abs(samples[i]);
      if (value > peak) {
        peak = value;
      }
    }
    peaks.push(Number((peak / 32_767).toFixed(3)));
  }
  void durationSec;
  return peaks;
}

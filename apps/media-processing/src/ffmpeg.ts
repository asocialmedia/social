// ffmpeg/ffprobe execution helpers. Every spawn is time-boxed and captures
// stderr for structured failures; uploads are parsed here, never executed.

import { ResourceLimitError } from "./resource-limit-error";

export class FfmpegError extends Error {
  override name = "FfmpegError";
}

export {
  // Raised when ffprobe reports a stream exceeding a decoder safety ceiling
  // (duration, fps, bitrate). Typed so callers reject the media without
  // retrying - the file is malformed-by-policy, not transiently broken.
  ResourceLimitError,
} from "./resource-limit-error";

export interface DecoderLimits {
  maxBitrateKbps: number;
  maxDimension: number;
  maxFps: number;
  maxVideoDurationSec: number;
}

// Shared ceiling enforcement for probed streams. Runs before any transcode:
// a 10-hour/240fps/200Mbps file must fail in milliseconds, not after
// minutes of encode work. `maxVideoDurationSec` guards the container
// duration; audio-only duration checks live with the audio job (the probe
// duration is the container's, whichever streams it carries).
export function enforceDecoderLimits(
  probe: ProbeResult,
  limits: DecoderLimits
): void {
  if (probe.durationSec > limits.maxVideoDurationSec) {
    throw new ResourceLimitError(
      `duration ${Math.round(probe.durationSec)}s exceeds limit ${limits.maxVideoDurationSec}s`
    );
  }
  if (probe.formatBitrateKbps > limits.maxBitrateKbps) {
    throw new ResourceLimitError(
      `bitrate ${probe.formatBitrateKbps}kbps exceeds limit ${limits.maxBitrateKbps}kbps`
    );
  }
  const { video } = probe;
  if (!video) {
    return;
  }
  if (video.fps > limits.maxFps) {
    throw new ResourceLimitError(
      `fps ${video.fps} exceeds limit ${limits.maxFps}`
    );
  }
  if (video.width > limits.maxDimension || video.height > limits.maxDimension) {
    throw new ResourceLimitError(
      `dimensions ${video.width}x${video.height} exceed limit ${limits.maxDimension}px`
    );
  }
}

export interface ProbeResult {
  durationSec: number;
  container: string;
  video: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    frameRateMode: "CFR" | "VFR" | "unknown";
    bitrateKbps: number;
    pixelFormat: string;
    colorSpace?: string;
    colorTransfer?: string;
    rotation: number;
  } | null;
  audio: {
    codec: string;
    sampleRateHz: number;
    channels: number;
    bitrateKbps: number;
  } | null;
  formatBitrateKbps: number;
}

interface FfprobeStream {
  avg_frame_rate?: string;
  bit_rate?: string;
  channels?: number;
  codec_name?: string;
  codec_type?: string;
  color_space?: string;
  color_transfer?: string;
  disposition?: Record<string, number>;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  sample_aspect_ratio?: string;
  sample_rate?: string;
  tags?: Record<string, string>;
  width?: number;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

export function parseRate(rate: string | undefined): number {
  if (!rate) {
    return 0;
  }
  const [num, den] = rate.split("/");
  const denominator = Number(den ?? 1);
  if (!Number.isFinite(Number(num)) || denominator === 0) {
    return 0;
  }
  return Number(num) / denominator;
}

// Wall-clock cap around any in-process async work without a native kill
// switch (ffprobe via Bun.spawn exit codes, Bun.Image encoders). The losing
// promise's work may continue in the background but the caller fails now,
// freeing the job to retry instead of pinning the worker slot.
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      // eslint-disable-next-line promise/avoid-new -- timer rejection needs a raw promise; there is no async/await equivalent for losing a race on a deadline
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new FfmpegError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function probeMedia(inputPath: string): Promise<ProbeResult> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      inputPath,
    ],
    { stderr: "pipe", stdout: "pipe" }
  );
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new FfmpegError(
      `ffprobe failed (${exitCode}): ${stderr.slice(0, 400)}`
    );
  }

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch (error) {
    throw new FfmpegError(`ffprobe produced invalid JSON: ${String(error)}`);
  }

  const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
  const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
  // Cover-art attachments are mjpeg video streams; ignore them for metadata.
  const realVideo =
    videoStream && videoStream.codec_name !== "mjpeg" ? videoStream : undefined;

  if (!realVideo && !audioStream) {
    throw new FfmpegError("no decodable video or audio stream found");
  }

  const fps = Math.round(parseRate(realVideo?.avg_frame_rate) * 100) / 100;
  const rFps = parseRate(realVideo?.r_frame_rate);
  let frameRateMode: "CFR" | "VFR" | "unknown" = "unknown";
  if (fps > 0 && rFps > 0) {
    frameRateMode = Math.abs(fps - rFps) < 0.01 ? "CFR" : "VFR";
  }

  const rotationTag = Number(
    realVideo?.tags?.rotate ??
      realVideo?.tags?.["rotate"] ??
      realVideo?.disposition?.rotation ??
      0
  );

  return {
    audio: audioStream
      ? {
          bitrateKbps: Math.round(Number(audioStream.bit_rate ?? 0) / 1000),
          channels: audioStream.channels ?? 2,
          codec: audioStream.codec_name ?? "unknown",
          sampleRateHz: Number(audioStream.sample_rate ?? 48_000),
        }
      : null,
    container: parsed.format?.format_name?.split(",")[0] ?? "unknown",
    durationSec: Number(parsed.format?.duration ?? 0),
    formatBitrateKbps: Math.round(Number(parsed.format?.bit_rate ?? 0) / 1000),
    video:
      realVideo && realVideo.width && realVideo.height
        ? {
            bitrateKbps: Math.round(Number(realVideo.bit_rate ?? 0) / 1000),
            codec: realVideo.codec_name ?? "unknown",
            colorSpace: realVideo.color_space ?? undefined,
            colorTransfer: realVideo.color_transfer ?? undefined,
            fps,
            frameRateMode,
            height: realVideo.height,
            pixelFormat: realVideo.pix_fmt ?? "unknown",
            rotation: Number.isFinite(rotationTag) ? rotationTag : 0,
            width: realVideo.width,
          }
        : null,
  };
}

// Runs ffmpeg with a hard wall-clock timeout. On timeout the process tree is
// killed and a typed error thrown so callers can fail the job cleanly.
export async function runFfmpeg(
  args: string[],
  timeoutMs: number
): Promise<void> {
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // Already exited.
    }
  }, timeoutMs);

  const proc = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args],
    {
      stderr: "pipe",
      stdout: "ignore",
    }
  );

  try {
    const [stderrText, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new FfmpegError(
        `ffmpeg failed (${exitCode}): ${stderrText.slice(-400)}`
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

// Extracts a WxH grayscale raw frame grid for perceptual hashing: dHash needs
// exactly 9x8 luminance bytes. Works for any input ffmpeg can decode.
export async function extractGrayPixels(
  inputPath: string,
  seekSec: number,
  width = 9,
  height = 8,
  timeoutMs = 30_000
): Promise<Uint8Array> {
  const expected = width * height;
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, seekSec)),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:${height}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "pipe:1",
    ],
    { stderr: "ignore", stdin: "ignore", stdout: "pipe" }
  );

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // Exited already.
    }
  }, timeoutMs);

  try {
    const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    const code = await proc.exited;
    if (code !== 0 || bytes.length < expected) {
      throw new FfmpegError(`gray frame extraction failed (${code})`);
    }
    return bytes.subarray(0, expected);
  } finally {
    clearTimeout(timer);
  }
}

// 64-bit dHash over 9x8 grayscale pixels: horizontal gradient comparisons.
export function dHash64(pixels: Uint8Array): string {
  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      if (left > right) {
        hash |= 1n << bit;
      }
      bit += 1n;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export async function computePerceptualHash(
  inputPath: string,
  durationSec: number,
  timeoutMs: number
): Promise<string> {
  const seek = durationSec > 3 ? Math.min(durationSec * 0.25, 5) : 0;
  const pixels = await extractGrayPixels(inputPath, seek, 9, 8, timeoutMs);
  return dHash64(pixels);
}

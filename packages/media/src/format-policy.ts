// Derivative planning. Pure decision tables: given validated source
// properties, produce exactly the derivatives worth generating (never upscale,
// never generate sizes the source cannot justify).
//
// Codec reality (verified against Bun docs): the media-processing worker runs
// on Linux where Bun.Image encodes JPEG/PNG/WebP only - AVIF/HEIC/TIFF are
// OS-backends that do not exist on Linux. Delivery format is therefore WebP
// (universally supported in browsers since Safari 14 / 2020) with JPEG
// fallback copies for the small preview sizes. AVIF becomes an easy win later
// if the worker gains a libavif encoder.

import type { DerivativeKind } from "./types";

export type ImageClass = "photo" | "graphic" | "animated" | "alpha";
export type ImageFormat = "webp" | "png" | "jpeg";

export interface ImagePlanInput {
  width: number;
  height: number;
  hasAlpha: boolean;
  isAnimated: boolean;
  // Fraction of unique colors in a downscaled sample; low values suggest
  // flat graphics/screenshots rather than photography. 0-1.
  colorEntropy: number;
}

export interface PlannedImageDerivative {
  kind: Extract<DerivativeKind, "thumb" | "sm" | "md" | "lg" | "orig-img">;
  // Format name doubles as the derivative variant identifier.
  variant: ImageFormat;
  width: number;
  height: number;
  quality: number;
  // Indexed PNG mode for flat-color graphics (3-5x smaller).
  palette?: boolean;
}

// Width ladder: only widths at or below the source are produced.
const IMAGE_WIDTH_LADDER = [
  { kind: "thumb", width: 320 },
  { kind: "sm", width: 640 },
  { kind: "md", width: 800 },
  { kind: "lg", width: 1200 },
] as const;

const ORIG_IMG_MAX_WIDTH = 1600;

// Sizes that also get a JPEG fallback copy for ancient clients.
const JPEG_FALLBACK_KINDS: ReadonlySet<string> = new Set(["thumb", "md"]);

export function classifyImage(input: ImagePlanInput): ImageClass {
  if (input.isAnimated) {
    return "animated";
  }
  if (input.hasAlpha) {
    return "alpha";
  }
  return input.colorEntropy < 0.25 ? "graphic" : "photo";
}

interface ClassQuality {
  quality: number;
  palette: boolean;
}

const CLASS_QUALITY: Record<ImageClass, ClassQuality> = {
  alpha: { palette: false, quality: 82 },
  animated: { palette: false, quality: 75 },
  graphic: { palette: false, quality: 85 },
  photo: { palette: false, quality: 78 },
};

function scaledHeight(width: number, input: ImagePlanInput): number {
  const scale = width / input.width;
  return Math.max(1, Math.round(input.height * scale));
}

export function planImageDerivatives(
  input: ImagePlanInput
): PlannedImageDerivative[] {
  if (input.width <= 0 || input.height <= 0) {
    return [];
  }
  const imageClass = classifyImage(input);
  const settings = CLASS_QUALITY[imageClass];
  const plan: PlannedImageDerivative[] = [];

  for (const rung of IMAGE_WIDTH_LADDER) {
    if (rung.width > input.width) {
      break;
    }
    const height = scaledHeight(rung.width, input);
    plan.push({
      height,
      kind: rung.kind,
      palette: settings.palette,
      quality: settings.quality,
      variant: "webp",
      width: rung.width,
    });
    if (JPEG_FALLBACK_KINDS.has(rung.kind)) {
      plan.push({
        height,
        kind: rung.kind,
        palette: false,
        quality: 80,
        variant: "jpeg",
        width: rung.width,
      });
    }
  }

  // A stripped, re-encoded original-resolution derivative is justified for
  // sources at or below the display ceiling; larger originals stay private.
  // Animated sources serve their original bytes directly instead.
  if (input.width <= ORIG_IMG_MAX_WIDTH && !input.isAnimated) {
    plan.push({
      height: input.height,
      kind: "orig-img",
      palette: settings.palette,
      quality: Math.min(92, settings.quality + 12),
      variant: "webp",
      width: input.width,
    });
  }

  return plan;
}

// Video ladder. Never upscales; heights above the source are dropped.
export interface VideoLadderRung {
  variant: string;
  height: number;
  videoKbps: number;
  audioKbps: number;
}

const HLS_THRESHOLD_SEC = 90;

const FULL_LADDER: VideoLadderRung[] = [
  { audioKbps: 64, height: 360, variant: "360p", videoKbps: 800 },
  { audioKbps: 96, height: 480, variant: "480p", videoKbps: 1400 },
  { audioKbps: 128, height: 720, variant: "720p", videoKbps: 2500 },
  { audioKbps: 128, height: 1080, variant: "1080p", videoKbps: 5000 },
];

export interface VideoPlan {
  progressiveMp4: boolean;
  hls: boolean;
  hlsLadder: VideoLadderRung[];
  poster: boolean;
}

export function planVideoOutputs(input: {
  durationSec: number;
  srcHeight: number;
}): VideoPlan {
  const needsHls =
    input.durationSec > HLS_THRESHOLD_SEC || input.srcHeight > 1080;
  const hlsLadder = needsHls
    ? FULL_LADDER.filter((rung) => rung.height <= input.srcHeight)
    : [];
  // Fall back to the lowest rung so very short/small sources still stream if
  // HLS was demanded by duration.
  if (needsHls && hlsLadder.length === 0 && FULL_LADDER[0]) {
    hlsLadder.push(FULL_LADDER[0]);
  }
  return {
    hls: needsHls,
    hlsLadder,
    poster: true,
    progressiveMp4: true,
  };
}

// Audio normalization target: EBU R128 streaming loudness.
export const AUDIO_TARGET_LUFS = -16;
export const AUDIO_OPUS_KBPS = 96;
export const AUDIO_AAC_KBPS = 128;
export const WAVEFORM_PEAK_POINTS = 200;

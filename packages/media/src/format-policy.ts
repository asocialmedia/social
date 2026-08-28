// Derivative planning. Pure decision tables: given validated source
// properties, produce exactly the derivatives worth generating (never upscale,
// never generate sizes the source cannot justify).
//
// Codec reality (verified against Bun docs): the media-processing worker runs
// on Linux where Bun.Image encodes JPEG/PNG/WebP only - AVIF/HEIC/TIFF are
// OS-backends that do not exist on Linux. Delivery format is therefore
// WebP (universally supported in browsers since Safari 14 / 2020) with JPEG
// fallback copies for small preview sizes on non-transparent images; AVIF
// would slot ahead of WebP once the worker gains a libavif encoder.

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
  // True when the uploaded bytes are a lossless encoding (PNG, static GIF,
  // lossless WebP). Photographic JPEGs and lossy WebPs stay false so their
  // derivatives keep perceptual (lossy) encoding.
  isLosslessSource: boolean;
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
  // Pixel-exact WebP for the orig-img rung of lossless sources. Lossless
  // encodes of flat/low-color content compress as well as or better than
  // PNG while remaining bit-identical to the source pixels.
  lossless?: boolean;
}

// Width ladder: only widths at or below the source are produced.
const IMAGE_WIDTH_LADDER = [
  { kind: "thumb", width: 320 },
  { kind: "sm", width: 640 },
  { kind: "md", width: 800 },
  { kind: "lg", width: 1200 },
] as const;

// Sources at or below this width get an original-resolution derivative so
// fullscreen viewing never shows a downscaled ladder rung. Covers every
// mainstream display class up to 4K desktop monitors.
const ORIG_IMG_MAX_WIDTH = 4096;

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

// Quality floor chosen for full-width retina display: WebP chroma
// subsampling starts smearing saturated edges well below ~q80, which reads
// as "blurry" next to the original bytes these derivatives replace.
const CLASS_QUALITY: Record<ImageClass, ClassQuality> = {
  alpha: { palette: false, quality: 86 },
  animated: { palette: false, quality: 78 },
  graphic: { palette: true, quality: 88 },
  photo: { palette: false, quality: 84 },
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
    // JPEG has no alpha channel: transparent sources must not get a
    // JPEG fallback that would composite against black. Ancient clients
    // on those images just get the WebP ladder rung at the same width.
    if (!input.hasAlpha && JPEG_FALLBACK_KINDS.has(rung.kind)) {
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

  // A source-resolution derivative keeps fullscreen viewing at native
  // fidelity. Lossless sources (PNG / static GIF / lossless WebP) that
  // classify as graphic or alpha get a bit-exact lossless WebP; photos and
  // lossy sources get a high-quality perceptual encode - a lossless encode
  // of noisy photographic content would dwarf the upload itself.
  // Tiny sources that fit no ladder rung still need an orig-img so
  // something is servable; otherwise orig-img is redundant with thumb.
  const ladderRungCount = IMAGE_WIDTH_LADDER.filter(
    (r) => r.width <= input.width
  ).length;
  if (
    input.width <= ORIG_IMG_MAX_WIDTH &&
    (input.width > 320 || ladderRungCount === 0) &&
    !input.isAnimated
  ) {
    plan.push({
      height: input.height,
      kind: "orig-img",
      lossless: input.isLosslessSource && imageClass !== "photo",
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

// ── Published-original metadata policy (video/audio) ───────────────────────
// Static rasters are scrubbed structurally by strip-metadata.ts. Video and
// audio containers carry EXIF-class metadata too (QuickTime udta keys, MP4
// ilst tags, ID3, XMP, GPS in phone recordings), so the published ORIGINAL
// is scrubbed with a lossless ffmpeg remux (-map_metadata -1, stream copy)
// before it is stamped and promoted. Pure decision tables live here so the
// worker and tests share one source of truth.

// Content-signature containers whose published original gets the remux scrub.
// These mirror the `container` values emitted by detectContent() in magic.ts.
const AV_STRIP_CONTAINERS: ReadonlySet<string> = new Set([
  "iso-bmff",
  "mov",
  "m4a",
  "webm",
  "mkv",
  "avi",
  "flv",
  "mpeg-audio",
  "ogg",
  "flac",
  "wav",
  "aac-adts",
]);

export function isAvMetadataStripContainer(container: string): boolean {
  return AV_STRIP_CONTAINERS.has(container);
}

// File extension that selects ffmpeg's output muxer for a detected container.
// Mismatched extensions make the remux fail closed (the caller publishes the
// scanned bytes), so this table must stay exact.
const AV_CONTAINER_EXTENSIONS: Record<string, string> = {
  "aac-adts": "aac",
  avi: "avi",
  flac: "flac",
  flv: "flv",
  "iso-bmff": "mp4",
  m4a: "m4a",
  mkv: "mkv",
  mov: "mov",
  "mpeg-audio": "mp3",
  ogg: "ogg",
  wav: "wav",
  webm: "webm",
};

export function avContainerExtension(container: string): string | null {
  return AV_CONTAINER_EXTENSIONS[container] ?? null;
}

// Containers whose muxer supports (and needs) progressive moov placement so
// browsers can start playback before the whole file arrives.
const FASTSTART_CONTAINERS: ReadonlySet<string> = new Set([
  "iso-bmff",
  "mov",
  "m4a",
]);

export function needsFaststart(container: string): boolean {
  return FASTSTART_CONTAINERS.has(container);
}

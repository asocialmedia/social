// Shared contracts for the media pipeline. This module is intentionally pure:
// no database, Redis, filesystem, or network imports. Both the web app (upload
// API, serving routes, frontend limits) and apps/media-processing (workers)
// import from here so the pipeline contract cannot drift between them.

export type MediaType = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";

// Explicit lifecycle. Media must never be publicly served before it reaches
// READY through the controlled pipeline (legacy rows without derivatives are
// handled by the serving-route fallback rule, see media-access).
export type MediaStatus =
  | "UPLOADING"
  | "QUARANTINED"
  | "SCANNING"
  | "PROCESSING"
  | "READY"
  | "FAILED"
  | "REJECTED"
  | "DELETED";

export type RejectionReason =
  | "MALWARE"
  | "MIME_MISMATCH"
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "TOO_LONG"
  | "CORRUPT"
  | "POLICY";

export type MediaVisibility = "PUBLIC" | "UNLISTED" | "PRIVATE";

export const MEDIA_PIPELINE_VERSION = "2";

// Bumped when encoder settings change materially; recorded per derivative
// and on the Media row's encoderVersion.
export const MEDIA_ENCODER_VERSION = "enc-2026-09";

export interface DetectedContent {
  family: MediaType;
  mime: string;
  container: string;
}

// BullMQ job payloads on the "media" queue.
export interface MediaScanJobData {
  mediaId: string;
  backfill?: boolean;
}
export interface MediaProcessJobData {
  mediaId: string;
}
export interface MediaAnalyzeJobData {
  mediaId: string;
}
export interface MediaDeleteCascadeJobData {
  mediaId: string;
}
export interface MediaCleanupJobData {
  mediaId: string;
}

export const MEDIA_JOB_NAMES = {
  analyze: "media-analyze",
  cleanup: "media-cleanup",
  deleteCascade: "media-delete-cascade",
  process: "media-process",
  scan: "media-scan",
} as const;

// Derivative kinds. `name` in storage keys is `${kind}-${variant}.${ext}`.
// The tiny LQIP placeholder is NOT an object: Bun.Image's ThumbHash
// .placeholder() data URL (~500 bytes) is stored directly on the media row.
export type DerivativeKind =
  | "thumb"
  | "sm"
  | "md"
  | "lg"
  | "orig-img"
  | "poster"
  | "hls"
  | "audio-opus"
  | "audio-aac"
  | "wave"
  | "cover";

export interface DerivativeRecordInput {
  kind: DerivativeKind;
  variant: string;
  key: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  durationMs?: number;
}

// Structured failure surfaced on Media.failureCode/detail and in metrics.
export interface PipelineFailure {
  code:
    | "scan-failed"
    | "probe-failed"
    | "decode-failed"
    | "encode-failed"
    | "storage-failed"
    | "limit-exceeded"
    | "timeout"
    | "unknown";
  message: string;
  retryable: boolean;
}

// Technical metadata extracted from validated sources. Stored as JSON on
// Media.techMetadata; the database is authoritative over file metadata.
export interface ImageTechMetadata {
  width: number;
  height: number;
  aspectRatio: number;
  orientation: number;
  hasAlpha: boolean;
  isAnimated: boolean;
  frameCount: number;
  bitDepth: number;
  colorSpace: string;
  hasIccProfile: boolean;
  format: string;
  bytes: number;
}

export interface VideoStreamMetadata {
  codec: string;
  width: number;
  height: number;
  fps: number;
  frameRateMode: "CFR" | "VFR" | "unknown";
  bitrateKbps: number;
  pixelFormat: string;
  isHdr: boolean;
  rotation: number;
}

export interface AudioStreamMetadata {
  codec: string;
  sampleRateHz: number;
  channels: number;
  bitrateKbps: number;
  loudnessLufs?: number;
}

export interface VideoTechMetadata {
  durationSec: number;
  container: string;
  video: VideoStreamMetadata;
  audio?: AudioStreamMetadata;
  startPts: number;
  bytes: number;
}

export interface AudioTechMetadata {
  durationSec: number;
  container: string;
  audio: AudioStreamMetadata;
  hasCoverArt: boolean;
  bytes: number;
}

export function isVideoTechMetadata(
  value: unknown
): value is VideoTechMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<VideoTechMetadata>;
  return (
    typeof candidate.durationSec === "number" &&
    typeof candidate.container === "string" &&
    typeof candidate.video === "object" &&
    candidate.video !== null
  );
}

export function isAudioTechMetadata(
  value: unknown
): value is AudioTechMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AudioTechMetadata>;
  return (
    typeof candidate.durationSec === "number" &&
    typeof candidate.audio === "object" &&
    candidate.audio !== null
  );
}

// NSFW / moderation verdicts stored on Media.safety.
export interface SafetyVerdict {
  nsfwScore: number;
  nsfwLabel: "neutral" | "sexy" | "porn" | "hentai" | "drawings" | "unknown";
  explicit: boolean;
  modelVersion: string;
  evaluatedAt: string;
}

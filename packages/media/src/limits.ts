// Central, env-overridable media limits. The DEFAULT_LIMITS constant is
// isomorphic (importable from client bundles to mirror server validation);
// resolveMediaLimits() overlays environment overrides and must only run
// server-side.

export interface MediaLimits {
  // Per-request body ceiling accepted from the network before any parsing.
  maxRequestBytes: number;
  maxImageBytes: number;
  maxVideoBytes: number;
  maxAudioBytes: number;
  maxDocumentBytes: number;
  // Decoder safety ceilings.
  maxPixelCount: number;
  maxDimension: number;
  maxVideoDurationSec: number;
  maxAudioDurationSec: number;
  maxFps: number;
  maxBitrateKbps: number;
  // Abuse ceilings.
  maxFilesPerRequest: number;
  maxUploadsPerDayPerUser: number;
  maxUploadsPerMinutePerUser: number;
  maxConcurrentProcessingPerUser: number;
  maxUserStorageBytes: number;
  // Worker budgets.
  processingTimeoutMs: number;
  scanTimeoutMs: number;
  // Retention for the private original after READY (0 = keep forever).
  originalRetentionDays: number;
}

export const DEFAULT_LIMITS: MediaLimits = {
  maxAudioBytes: 50 * 1024 * 1024,
  maxAudioDurationSec: 60 * 60,
  // Decoder "fail fast" ceiling for the process stage. Calibrated above the
  // highest consumer phone recording mode (iPhone 4K60 HDR ~90-95 Mbps) so
  // ordinary device footage passes; total transcode work is already bounded
  // by maxVideoBytes x maxVideoDurationSec. Only pathological streams
  // (200 Mbps+) should be rejected in milliseconds here. Override with
  // MEDIA_MAX_BITRATE_KBPS.
  maxBitrateKbps: 100_000,
  maxConcurrentProcessingPerUser: 5,
  maxDimension: 20_000,
  maxDocumentBytes: 25 * 1024 * 1024,
  maxFilesPerRequest: 5,
  maxFps: 60,
  maxImageBytes: 25 * 1024 * 1024,
  maxPixelCount: 100_000_000,
  maxRequestBytes: 260 * 1024 * 1024,
  maxUploadsPerDayPerUser: 120,
  maxUploadsPerMinutePerUser: 10,
  maxUserStorageBytes: 5 * 1024 * 1024 * 1024,
  maxVideoBytes: 250 * 1024 * 1024,
  maxVideoDurationSec: 30 * 60,
  originalRetentionDays: 30,
  processingTimeoutMs: 15 * 60 * 1000,
  scanTimeoutMs: 5 * 60 * 1000,
};

function positiveInt(
  raw: string | undefined,
  _fallback: number
): number | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function resolveMediaLimits(
  env: Record<string, string | undefined>
): MediaLimits {
  const overrides: Partial<MediaLimits> = {};
  const assign = (key: keyof MediaLimits, varName: string) => {
    const parsed = positiveInt(env[varName], DEFAULT_LIMITS[key]);
    if (parsed !== undefined) {
      overrides[key] = parsed as never;
    }
  };
  assign("maxRequestBytes", "MEDIA_MAX_REQUEST_BYTES");
  assign("maxImageBytes", "MEDIA_MAX_IMAGE_BYTES");
  assign("maxVideoBytes", "MEDIA_MAX_VIDEO_BYTES");
  assign("maxAudioBytes", "MEDIA_MAX_AUDIO_BYTES");
  assign("maxDocumentBytes", "MEDIA_MAX_DOCUMENT_BYTES");
  assign("maxPixelCount", "MEDIA_MAX_PIXEL_COUNT");
  assign("maxDimension", "MEDIA_MAX_DIMENSION");
  assign("maxVideoDurationSec", "MEDIA_MAX_VIDEO_DURATION_SEC");
  assign("maxAudioDurationSec", "MEDIA_MAX_AUDIO_DURATION_SEC");
  assign("maxFps", "MEDIA_MAX_FPS");
  assign("maxBitrateKbps", "MEDIA_MAX_BITRATE_KBPS");
  assign("maxFilesPerRequest", "MEDIA_MAX_FILES_PER_REQUEST");
  assign("maxUploadsPerDayPerUser", "MEDIA_UPLOADS_PER_DAY");
  assign("maxUploadsPerMinutePerUser", "MEDIA_UPLOADS_PER_MINUTE");
  assign(
    "maxConcurrentProcessingPerUser",
    "MEDIA_CONCURRENT_PROCESSING_PER_USER"
  );
  assign("maxUserStorageBytes", "MEDIA_USER_STORAGE_QUOTA_BYTES");
  assign("processingTimeoutMs", "MEDIA_PROCESSING_TIMEOUT_MS");
  assign("scanTimeoutMs", "MEDIA_SCAN_TIMEOUT_MS");
  assign("originalRetentionDays", "MEDIA_ORIGINAL_RETENTION_DAYS");
  return { ...DEFAULT_LIMITS, ...overrides };
}

// Category -> byte cap mapping shared by upload validation on both sides.
export function maxBytesForType(limits: MediaLimits, type: string): number {
  switch (type) {
    case "IMAGE": {
      return limits.maxImageBytes;
    }
    case "VIDEO": {
      return limits.maxVideoBytes;
    }
    case "AUDIO": {
      return limits.maxAudioBytes;
    }
    case "DOCUMENT": {
      return limits.maxDocumentBytes;
    }
    default: {
      return 0;
    }
  }
}

// Hard ceiling on attachments per post, enforced client-side (composer
// truncates over-capacity bunches) and server-side (submitPost rejects).
// Exported from the pure contracts package so both sides cannot drift.
export const MAX_POST_ATTACHMENTS = 10;

import { resolveMediaLimits } from "@asm/media";
import type { MediaLimits } from "@asm/media";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Worker environment contract, validated once at import. Every variable has a
// localhost default so dev/test imports never throw; production deployments
// inject the real values (see apps/media-processing/.env.development for the
// documented shape).

const numericOverride = z
  .string()
  .optional()
  .transform((value) => value);

export const keys = createEnv({
  runtimeEnv: {
    ASMOB_BUCKET_NAME: process.env.ASMOB_BUCKET_NAME,
    ASMOB_ENDPOINT: process.env.ASMOB_ENDPOINT,
    ASMOB_REGION: process.env.ASMOB_REGION,
    ASMOB_ROOT_PASSWORD: process.env.ASMOB_ROOT_PASSWORD,
    ASMOB_ROOT_USER: process.env.ASMOB_ROOT_USER,
    CLAMAV_HOST: process.env.CLAMAV_HOST,
    CLAMAV_PORT: process.env.CLAMAV_PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    LOG_LEVEL: process.env.LOG_LEVEL,
    MEDIA_AUDIO_WATERMARK_TIMEOUT_MS:
      process.env.MEDIA_AUDIO_WATERMARK_TIMEOUT_MS,
    MEDIA_BACKFILL_ENABLED: process.env.MEDIA_BACKFILL_ENABLED,
    MEDIA_C2PA_CERT_PATH: process.env.MEDIA_C2PA_CERT_PATH,
    MEDIA_C2PA_KEY_PATH: process.env.MEDIA_C2PA_KEY_PATH,
    MEDIA_C2PA_STAMP: process.env.MEDIA_C2PA_STAMP,
    MEDIA_C2PA_STAMP_TIMEOUT_MS: process.env.MEDIA_C2PA_STAMP_TIMEOUT_MS,
    MEDIA_C2PA_TSA_URL: process.env.MEDIA_C2PA_TSA_URL,
    MEDIA_CLASSIFY_ENABLED: process.env.MEDIA_CLASSIFY_ENABLED,
    MEDIA_CONCURRENT_PROCESSING_PER_USER:
      process.env.MEDIA_CONCURRENT_PROCESSING_PER_USER,
    MEDIA_EMBEDDING_ENABLED: process.env.MEDIA_EMBEDDING_ENABLED,
    MEDIA_HEALTH_PORT: process.env.MEDIA_HEALTH_PORT,
    MEDIA_IMAGE_WATERMARK_TIMEOUT_MS:
      process.env.MEDIA_IMAGE_WATERMARK_TIMEOUT_MS,
    MEDIA_LEGACY_GC_ENABLED: process.env.MEDIA_LEGACY_GC_ENABLED,
    MEDIA_MAX_AUDIO_BYTES: process.env.MEDIA_MAX_AUDIO_BYTES,
    MEDIA_MAX_IMAGE_BYTES: process.env.MEDIA_MAX_IMAGE_BYTES,
    MEDIA_MAX_REQUEST_BYTES: process.env.MEDIA_MAX_REQUEST_BYTES,
    MEDIA_MAX_VIDEO_BYTES: process.env.MEDIA_MAX_VIDEO_BYTES,
    MEDIA_OCR_ENABLED: process.env.MEDIA_OCR_ENABLED,
    MEDIA_ORIGINAL_RETENTION_DAYS: process.env.MEDIA_ORIGINAL_RETENTION_DAYS,
    MEDIA_PROCESSING_TIMEOUT_MS: process.env.MEDIA_PROCESSING_TIMEOUT_MS,
    MEDIA_PROCESS_CONCURRENCY: process.env.MEDIA_PROCESS_CONCURRENCY,
    MEDIA_REQUIRE_CLAMAV: process.env.MEDIA_REQUIRE_CLAMAV,
    MEDIA_SCAN_CONCURRENCY: process.env.MEDIA_SCAN_CONCURRENCY,
    MEDIA_SCAN_TIMEOUT_MS: process.env.MEDIA_SCAN_TIMEOUT_MS,
    MEDIA_UPLOADS_PER_DAY: process.env.MEDIA_UPLOADS_PER_DAY,
    MEDIA_WATERMARK_PEPPER: process.env.MEDIA_WATERMARK_PEPPER,
    MEDIA_WHISPER_ENABLED: process.env.MEDIA_WHISPER_ENABLED,
    // Same public origin the web app publishes; the worker needs it to write
    // absolute provenance identifiers into stamped manifests.
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NODE_ENV: process.env.NODE_ENV,
    OPENOBSERVE_LOG_STREAM: process.env.OPENOBSERVE_LOG_STREAM,
    OPENOBSERVE_METRIC_STREAM: process.env.OPENOBSERVE_METRIC_STREAM,
    OPENOBSERVE_ORG: process.env.OPENOBSERVE_ORG,
    OPENOBSERVE_PASSWORD: process.env.OPENOBSERVE_PASSWORD,
    OPENOBSERVE_TRACE_STREAM: process.env.OPENOBSERVE_TRACE_STREAM,
    OPENOBSERVE_USER: process.env.OPENOBSERVE_USER,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    REDIS_URL: process.env.REDIS_URL,
  },
  server: {
    ASMOB_BUCKET_NAME: z.string().min(1).default("uploads"),
    ASMOB_ENDPOINT: z.url().default("http://localhost:9090"),
    ASMOB_REGION: z.string().min(1).default("ap-south-1"),
    ASMOB_ROOT_PASSWORD: z.string().min(1).default("asmob-admin"),
    ASMOB_ROOT_USER: z.string().min(1).default("asmob-admin"),
    // Unset in development disables AV scanning with a loud warning per scan;
    // MEDIA_REQUIRE_CLAMAV=0 turns that warning off entirely.
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    // Provenance stamping identity. Unset (the default) disables embedding
    // signed C2PA manifests - AI detection still records to the database.
    // Generate a dev pair via `bun scripts/generate-c2pa-cert.ts`.
    DATABASE_URL: z
      .url()
      .default(
        "postgresql://postgres:postgres@localhost:5433/asocialmedia?schema=public"
      ),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
    GROQ_API_KEY: z.string().optional(),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    // Migration sweeps. Backfill converts legacy rows into the pipeline
    // (safe by design: live posts keep serving until READY). Legacy GC
    // deletes superseded raw objects and is therefore opt-in - flip it on
    // only after the migration has been verified in production.
    MEDIA_AUDIO_WATERMARK_TIMEOUT_MS: numericOverride,
    MEDIA_BACKFILL_ENABLED: z.enum(["0", "1"]).default("1"),
    MEDIA_C2PA_CERT_PATH: z.string().min(1).optional(),
    MEDIA_C2PA_KEY_PATH: z.string().min(1).optional(),
    MEDIA_C2PA_STAMP: z.enum(["0", "1"]).default("1"),
    MEDIA_C2PA_STAMP_TIMEOUT_MS: numericOverride,
    // RFC 3161 timestamp authority. With short-lived signing certs (the free
    // SSL.com tier expires yearly), timestamps are what keep OLD manifests
    // valid after expiry - without one every historical stamp ages badly.
    MEDIA_C2PA_TSA_URL: z.url().optional(),
    MEDIA_CLASSIFY_ENABLED: z.enum(["0", "1"]).default("1"),
    MEDIA_CONCURRENT_PROCESSING_PER_USER: numericOverride,
    MEDIA_EMBEDDING_ENABLED: z.enum(["0", "1"]).default("1"),
    MEDIA_HEALTH_PORT: z.coerce.number().int().default(3010),
    MEDIA_IMAGE_WATERMARK_TIMEOUT_MS: numericOverride,
    MEDIA_LEGACY_GC_ENABLED: z.enum(["0", "1"]).default("0"),
    MEDIA_MAX_AUDIO_BYTES: numericOverride,
    MEDIA_MAX_IMAGE_BYTES: numericOverride,
    MEDIA_MAX_REQUEST_BYTES: numericOverride,
    MEDIA_MAX_VIDEO_BYTES: numericOverride,
    // Scene-text OCR in the analyze stage (PP-OCRv4 via onnxruntime-node).
    // Models ship inside the @gutenye/ocr-node dependency - no external
    // download - so this is a plain on/off switch.
    MEDIA_OCR_ENABLED: z.enum(["0", "1"]).default("1"),
    // Days a published row's exact uploaded bytes stay under quarantine/
    // before the retention sweep deletes them (forensics / re-processing
    // window). 0 deletes the quarantine copy at publish instead. Default 30
    // lives in packages/media/src/limits.ts.
    MEDIA_ORIGINAL_RETENTION_DAYS: numericOverride,
    MEDIA_PROCESSING_TIMEOUT_MS: numericOverride,
    MEDIA_PROCESS_CONCURRENCY: z.coerce.number().int().positive().default(2),
    MEDIA_REQUIRE_CLAMAV: z.enum(["0", "1"]).default("1"),
    MEDIA_SCAN_CONCURRENCY: z.coerce.number().int().positive().default(4),
    MEDIA_SCAN_TIMEOUT_MS: numericOverride,
    MEDIA_UPLOADS_PER_DAY: numericOverride,
    MEDIA_WATERMARK_PEPPER: z.string().min(16).optional(),
    MEDIA_WHISPER_ENABLED: z.enum(["0", "1"]).default("1"),
    NEXT_PUBLIC_URL: z.url().default("https://social.localhost"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    OPENOBSERVE_LOG_STREAM: z.string().default("asm_media_logs"),
    OPENOBSERVE_METRIC_STREAM: z.string().default("asm_media_metrics"),
    OPENOBSERVE_ORG: z.string().default("default"),
    OPENOBSERVE_PASSWORD: z.string().optional(),
    OPENOBSERVE_TRACE_STREAM: z.string().default("asm_media_traces"),
    OPENOBSERVE_USER: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .url()
      .default("http://localhost:5080/api/default"),
    OTEL_SERVICE_NAME: z.string().default("media-processing"),
    REDIS_URL: z.url().default("redis://:asmredis@localhost:6379/0"),
  },

  skipValidation: process.env.NODE_ENV === "production",
});

// Runtime accessor surface used across the worker, derived from the validated
// keys so no module reads process.env directly.
export const workerEnv = {
  get ASMOB_BUCKET() {
    return keys.ASMOB_BUCKET_NAME;
  },
  get ASMOB_ENDPOINT() {
    return keys.ASMOB_ENDPOINT;
  },
  get BACKFILL_ENABLED() {
    return keys.MEDIA_BACKFILL_ENABLED === "1";
  },
  get C2PA_CERT_PATH() {
    return keys.MEDIA_C2PA_CERT_PATH;
  },
  get C2PA_KEY_PATH() {
    return keys.MEDIA_C2PA_KEY_PATH;
  },
  get C2PA_STAMP_ENABLED() {
    return keys.MEDIA_C2PA_STAMP === "1";
  },
  get C2PA_STAMP_TIMEOUT_MS() {
    const raw = keys.MEDIA_C2PA_STAMP_TIMEOUT_MS;
    return raw ? Number(raw) : 4000;
  },
  get C2PA_TSA_URL() {
    return keys.MEDIA_C2PA_TSA_URL;
  },
  get CLAMAV_HOST() {
    return keys.CLAMAV_HOST;
  },
  get CLAMAV_PORT() {
    return keys.CLAMAV_PORT;
  },
  get CLASSIFY_ENABLED() {
    return keys.MEDIA_CLASSIFY_ENABLED !== "0";
  },
  get EMBEDDING_ENABLED() {
    return keys.MEDIA_EMBEDDING_ENABLED !== "0";
  },
  get GEMINI_API_KEY() {
    return keys.GEMINI_API_KEY;
  },
  get GEMINI_EMBEDDING_MODEL() {
    return keys.GEMINI_EMBEDDING_MODEL;
  },
  get GROQ_API_KEY() {
    return keys.GROQ_API_KEY;
  },
  get HEALTH_PORT() {
    // Portless injects a dynamic PORT when running under `bun run dev`
    // (media.localhost routes to whatever it assigned); production leaves
    // PORT unset and falls back to the fixed container port.
    const dynamicPort = Number(process.env.PORT);
    if (Number.isInteger(dynamicPort) && dynamicPort > 0) {
      return dynamicPort;
    }
    return keys.MEDIA_HEALTH_PORT;
  },
  get IMAGE_WATERMARK_TIMEOUT_MS() {
    const raw = keys.MEDIA_IMAGE_WATERMARK_TIMEOUT_MS;
    return raw ? Number(raw) : 1500;
  },
  get LEGACY_GC_ENABLED() {
    return keys.MEDIA_LEGACY_GC_ENABLED === "1";
  },
  get OCR_ENABLED() {
    // Default-on: under NODE_ENV=production t3-env skipValidation bypasses
    // zod defaults, so an unset var must read as enabled - only an explicit
    // "0" turns OCR off.
    return keys.MEDIA_OCR_ENABLED !== "0";
  },
  get PHASH_ATTRIBUTION_ENABLED() {
    return true;
  },
  // Fail-closed when a scanner is configured: if clamd is unreachable, scans
  // fail and retry instead of publishing unscanned bytes. With no host set
  // (development), scanning is skipped loudly.
  get PROCESS_CONCURRENCY() {
    // t3-env skipValidation (NODE_ENV=production) bypasses z.coerce, so the
    // raw value arrives as the env string; BullMQ demands a real number.
    const parsed = Number(keys.MEDIA_PROCESS_CONCURRENCY);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
  },
  get PUBLIC_BASE_URL() {
    return keys.NEXT_PUBLIC_URL;
  },
  get REDIS_URL() {
    return keys.REDIS_URL;
  },
  get REQUIRE_CLAMAV() {
    return keys.MEDIA_REQUIRE_CLAMAV === "1";
  },
  get SCAN_CONCURRENCY() {
    // Same production string-coercion story as PROCESS_CONCURRENCY above.
    const parsed = Number(keys.MEDIA_SCAN_CONCURRENCY);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 4;
  },
  get WATERMARK_ENABLED() {
    return true;
  },
  get WATERMARK_PEPPER() {
    return keys.MEDIA_WATERMARK_PEPPER;
  },
  get WHISPER_ENABLED() {
    return keys.MEDIA_WHISPER_ENABLED !== "0";
  },
} as const;

// Raw string overrides consumed by resolveMediaLimits(); validated numerics
// live above and are re-parsed there.
export function resolveWorkerMediaLimits(): MediaLimits {
  return resolveMediaLimits({
    MEDIA_CONCURRENT_PROCESSING_PER_USER:
      keys.MEDIA_CONCURRENT_PROCESSING_PER_USER,
    MEDIA_MAX_AUDIO_BYTES: keys.MEDIA_MAX_AUDIO_BYTES,
    MEDIA_MAX_IMAGE_BYTES: keys.MEDIA_MAX_IMAGE_BYTES,
    MEDIA_MAX_REQUEST_BYTES: keys.MEDIA_MAX_REQUEST_BYTES,
    MEDIA_MAX_VIDEO_BYTES: keys.MEDIA_MAX_VIDEO_BYTES,
    MEDIA_ORIGINAL_RETENTION_DAYS: keys.MEDIA_ORIGINAL_RETENTION_DAYS,
    MEDIA_PROCESSING_TIMEOUT_MS: keys.MEDIA_PROCESSING_TIMEOUT_MS,
    MEDIA_SCAN_TIMEOUT_MS: keys.MEDIA_SCAN_TIMEOUT_MS,
    MEDIA_UPLOADS_PER_DAY: keys.MEDIA_UPLOADS_PER_DAY,
  });
}

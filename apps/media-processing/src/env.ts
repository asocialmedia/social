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
    LOG_LEVEL: process.env.LOG_LEVEL,
    MEDIA_C2PA_CERT_PATH: process.env.MEDIA_C2PA_CERT_PATH,
    MEDIA_C2PA_KEY_PATH: process.env.MEDIA_C2PA_KEY_PATH,
    MEDIA_C2PA_STAMP: process.env.MEDIA_C2PA_STAMP,
    MEDIA_C2PA_TSA_URL: process.env.MEDIA_C2PA_TSA_URL,
    MEDIA_CONCURRENT_PROCESSING_PER_USER:
      process.env.MEDIA_CONCURRENT_PROCESSING_PER_USER,
    MEDIA_HEALTH_PORT: process.env.MEDIA_HEALTH_PORT,
    MEDIA_MAX_AUDIO_BYTES: process.env.MEDIA_MAX_AUDIO_BYTES,
    MEDIA_MAX_IMAGE_BYTES: process.env.MEDIA_MAX_IMAGE_BYTES,
    MEDIA_MAX_REQUEST_BYTES: process.env.MEDIA_MAX_REQUEST_BYTES,
    MEDIA_MAX_VIDEO_BYTES: process.env.MEDIA_MAX_VIDEO_BYTES,
    MEDIA_ORIGINAL_RETENTION_DAYS: process.env.MEDIA_ORIGINAL_RETENTION_DAYS,
    MEDIA_PROCESSING_TIMEOUT_MS: process.env.MEDIA_PROCESSING_TIMEOUT_MS,
    MEDIA_REQUIRE_CLAMAV: process.env.MEDIA_REQUIRE_CLAMAV,
    MEDIA_SCAN_CONCURRENCY: process.env.MEDIA_SCAN_CONCURRENCY,
    MEDIA_SCAN_TIMEOUT_MS: process.env.MEDIA_SCAN_TIMEOUT_MS,
    MEDIA_UPLOADS_PER_DAY: process.env.MEDIA_UPLOADS_PER_DAY,
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
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    MEDIA_C2PA_CERT_PATH: z.string().min(1).optional(),
    MEDIA_C2PA_KEY_PATH: z.string().min(1).optional(),
    MEDIA_C2PA_STAMP: z.enum(["0", "1"]).default("1"),
    // RFC 3161 timestamp authority. With short-lived signing certs (the free
    // SSL.com tier expires yearly), timestamps are what keep OLD manifests
    // valid after expiry - without one every historical stamp ages badly.
    MEDIA_C2PA_TSA_URL: z.url().optional(),
    MEDIA_CONCURRENT_PROCESSING_PER_USER: numericOverride,
    MEDIA_HEALTH_PORT: z.coerce.number().int().default(3010),
    MEDIA_MAX_AUDIO_BYTES: numericOverride,
    MEDIA_MAX_IMAGE_BYTES: numericOverride,
    MEDIA_MAX_REQUEST_BYTES: numericOverride,
    MEDIA_MAX_VIDEO_BYTES: numericOverride,
    MEDIA_ORIGINAL_RETENTION_DAYS: numericOverride,
    MEDIA_PROCESSING_TIMEOUT_MS: numericOverride,
    MEDIA_REQUIRE_CLAMAV: z.enum(["0", "1"]).default("1"),
    MEDIA_SCAN_CONCURRENCY: z.coerce.number().int().positive().default(4),
    MEDIA_SCAN_TIMEOUT_MS: numericOverride,
    MEDIA_UPLOADS_PER_DAY: numericOverride,
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
  get C2PA_CERT_PATH() {
    return keys.MEDIA_C2PA_CERT_PATH;
  },
  get C2PA_KEY_PATH() {
    return keys.MEDIA_C2PA_KEY_PATH;
  },
  get C2PA_STAMP_ENABLED() {
    return keys.MEDIA_C2PA_STAMP === "1";
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
  get PUBLIC_BASE_URL() {
    return keys.NEXT_PUBLIC_URL;
  },
  get REDIS_URL() {
    return keys.REDIS_URL;
  },
  // Fail-closed when a scanner is configured: if clamd is unreachable, scans
  // fail and retry instead of publishing unscanned bytes. With no host set
  // (development), scanning is skipped loudly.
  get REQUIRE_CLAMAV() {
    return keys.MEDIA_REQUIRE_CLAMAV === "1";
  },
  get SCAN_CONCURRENCY() {
    return keys.MEDIA_SCAN_CONCURRENCY;
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

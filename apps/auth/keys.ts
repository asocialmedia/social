/** biome-ignore-all lint/style/useNamingConvention: ENV VARS */
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const keys = createEnv({
  server: {
    DATABASE_URL: z.url(),
    POSTGRES_PRISMA_URL: z.url().optional(),
    POSTGRES_URL_NON_POOLING: z.url().optional(),
    RESEND_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional()
    ),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    REDDIT_CLIENT_ID: z.string().optional(),
    REDDIT_CLIENT_SECRET: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(1),
    MEILISEARCH_URL: z.url().default("http://localhost:7700"),
    MEILISEARCH_MASTER_KEY: z.string().default("masterKey123"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    TURBO_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
    BETTER_AUTH_TELEMETRY: z.enum(["0", "1"]).default("0"),
    SUPPORT_EMAIL: z.email().default("hello@asocialmedia.cc"),
    AUTH_URL: z.url().default("https://auth.localhost"),
    APP_URL: z.url().default("https://social.localhost"),
    OTEL_ENABLED: z.enum(["true", "false"]).default("false"),
    OTEL_SERVICE_NAME: z.string().default("auth"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .url()
      .default("http://localhost:5080/api/default"),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    OPENOBSERVE_USER: z.string().optional(),
    OPENOBSERVE_PASSWORD: z.string().optional(),
    OPENOBSERVE_ORG: z.string().default("default"),
    OPENOBSERVE_LOG_STREAM: z.string().default("auth_logs"),
    OPENOBSERVE_METRIC_STREAM: z.string().default("auth_metrics"),
    OPENOBSERVE_TRACE_STREAM: z.string().default("auth_traces"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    AUTH_MAX_BODY_BYTES: z.coerce.number().default(100 * 1024),
    AUTH_MAX_CONCURRENT_REQUESTS: z.coerce.number().default(512),
    AUTH_REQUEST_TIMEOUT_MS: z.coerce.number().default(15_000),
    AUTH_AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    AUTH_AUTH_RATE_LIMIT_MAX: z.coerce.number().default(600),
    AUTH_ANON_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    AUTH_ANON_RATE_LIMIT_MAX: z.coerce.number().default(120),
    AUTH_STRICT_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    AUTH_STRICT_RATE_LIMIT_MAX: z.coerce.number().default(30),
    AUTH_BURST_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(5000),
    AUTH_BURST_RATE_LIMIT_MAX: z.coerce.number().default(30),
  },

  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_PRISMA_URL:
      process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL,
    POSTGRES_URL_NON_POOLING:
      process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    MEILISEARCH_URL: process.env.MEILISEARCH_URL,
    MEILISEARCH_MASTER_KEY: process.env.MEILISEARCH_MASTER_KEY,
    NODE_ENV: process.env.NODE_ENV,
    APP_URL: process.env.APP_URL,
    TURBO_TELEMETRY_DISABLED: process.env.TURBO_TELEMETRY_DISABLED,
    BETTER_AUTH_TELEMETRY: process.env.BETTER_AUTH_TELEMETRY,
    AUTH_URL: process.env.AUTH_URL,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    OPENOBSERVE_USER: process.env.OPENOBSERVE_USER,
    OPENOBSERVE_PASSWORD: process.env.OPENOBSERVE_PASSWORD,
    OPENOBSERVE_ORG: process.env.OPENOBSERVE_ORG,
    OPENOBSERVE_LOG_STREAM: process.env.OPENOBSERVE_LOG_STREAM,
    OPENOBSERVE_METRIC_STREAM: process.env.OPENOBSERVE_METRIC_STREAM,
    OPENOBSERVE_TRACE_STREAM: process.env.OPENOBSERVE_TRACE_STREAM,
    LOG_LEVEL: process.env.LOG_LEVEL,
    AUTH_MAX_BODY_BYTES: process.env.AUTH_MAX_BODY_BYTES,
    AUTH_MAX_CONCURRENT_REQUESTS: process.env.AUTH_MAX_CONCURRENT_REQUESTS,
    AUTH_REQUEST_TIMEOUT_MS: process.env.AUTH_REQUEST_TIMEOUT_MS,
    AUTH_AUTH_RATE_LIMIT_WINDOW_MS: process.env.AUTH_AUTH_RATE_LIMIT_WINDOW_MS,
    AUTH_AUTH_RATE_LIMIT_MAX: process.env.AUTH_AUTH_RATE_LIMIT_MAX,
    AUTH_ANON_RATE_LIMIT_WINDOW_MS: process.env.AUTH_ANON_RATE_LIMIT_WINDOW_MS,
    AUTH_ANON_RATE_LIMIT_MAX: process.env.AUTH_ANON_RATE_LIMIT_MAX,
    AUTH_STRICT_RATE_LIMIT_WINDOW_MS:
      process.env.AUTH_STRICT_RATE_LIMIT_WINDOW_MS,
    AUTH_STRICT_RATE_LIMIT_MAX: process.env.AUTH_STRICT_RATE_LIMIT_MAX,
    AUTH_BURST_RATE_LIMIT_WINDOW_MS:
      process.env.AUTH_BURST_RATE_LIMIT_WINDOW_MS,
    AUTH_BURST_RATE_LIMIT_MAX: process.env.AUTH_BURST_RATE_LIMIT_MAX,
  },

  skipValidation: process.env.NODE_ENV === "production",
});

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const keys = createEnv({
  runtimeEnv: {
    APP_URL: process.env.APP_URL,
    AUTH_ANON_RATE_LIMIT_MAX: process.env.AUTH_ANON_RATE_LIMIT_MAX,
    AUTH_ANON_RATE_LIMIT_WINDOW_MS: process.env.AUTH_ANON_RATE_LIMIT_WINDOW_MS,
    AUTH_AUTH_RATE_LIMIT_MAX: process.env.AUTH_AUTH_RATE_LIMIT_MAX,
    AUTH_AUTH_RATE_LIMIT_WINDOW_MS: process.env.AUTH_AUTH_RATE_LIMIT_WINDOW_MS,
    AUTH_BURST_RATE_LIMIT_MAX: process.env.AUTH_BURST_RATE_LIMIT_MAX,
    AUTH_BURST_RATE_LIMIT_WINDOW_MS:
      process.env.AUTH_BURST_RATE_LIMIT_WINDOW_MS,
    AUTH_MAX_BODY_BYTES: process.env.AUTH_MAX_BODY_BYTES,
    AUTH_MAX_CONCURRENT_REQUESTS: process.env.AUTH_MAX_CONCURRENT_REQUESTS,
    AUTH_REQUEST_TIMEOUT_MS: process.env.AUTH_REQUEST_TIMEOUT_MS,
    AUTH_STRICT_RATE_LIMIT_MAX: process.env.AUTH_STRICT_RATE_LIMIT_MAX,
    AUTH_STRICT_RATE_LIMIT_WINDOW_MS:
      process.env.AUTH_STRICT_RATE_LIMIT_WINDOW_MS,
    AUTH_URL: process.env.AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_TELEMETRY: process.env.BETTER_AUTH_TELEMETRY,
    DATABASE_URL: process.env.DATABASE_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NODE_ENV: process.env.NODE_ENV,
    OPENOBSERVE_LOG_STREAM: process.env.OPENOBSERVE_LOG_STREAM,
    OPENOBSERVE_METRIC_STREAM: process.env.OPENOBSERVE_METRIC_STREAM,
    OPENOBSERVE_ORG: process.env.OPENOBSERVE_ORG,
    OPENOBSERVE_PASSWORD: process.env.OPENOBSERVE_PASSWORD,
    OPENOBSERVE_TRACE_STREAM: process.env.OPENOBSERVE_TRACE_STREAM,
    OPENOBSERVE_USER: process.env.OPENOBSERVE_USER,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    POSTGRES_PRISMA_URL:
      process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL,
    POSTGRES_URL_NON_POOLING:
      process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL,
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    TURBO_TELEMETRY_DISABLED: process.env.TURBO_TELEMETRY_DISABLED,
  },

  server: {
    APP_URL: z.url().default("https://social.localhost"),
    AUTH_ANON_RATE_LIMIT_MAX: z.coerce.number().default(120),
    AUTH_ANON_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    AUTH_AUTH_RATE_LIMIT_MAX: z.coerce.number().default(600),
    AUTH_AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    AUTH_BURST_RATE_LIMIT_MAX: z.coerce.number().default(30),
    AUTH_BURST_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(5000),
    AUTH_MAX_BODY_BYTES: z.coerce.number().default(100 * 1024),
    AUTH_MAX_CONCURRENT_REQUESTS: z.coerce.number().default(512),
    AUTH_REQUEST_TIMEOUT_MS: z.coerce.number().default(15_000),
    AUTH_STRICT_RATE_LIMIT_MAX: z.coerce.number().default(30),
    AUTH_STRICT_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    AUTH_URL: z.url().default("https://auth.localhost"),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_TELEMETRY: z.enum(["0", "1"]).default("0"),
    DATABASE_URL: z.url(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    OPENOBSERVE_LOG_STREAM: z.string().default("auth_logs"),
    OPENOBSERVE_METRIC_STREAM: z.string().default("auth_metrics"),
    OPENOBSERVE_ORG: z.string().default("default"),
    OPENOBSERVE_PASSWORD: z.string().optional(),
    OPENOBSERVE_TRACE_STREAM: z.string().default("auth_traces"),
    OPENOBSERVE_USER: z.string().optional(),
    OTEL_ENABLED: z.enum(["true", "false"]).default("false"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .url()
      .default("http://localhost:5080/api/default"),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    OTEL_SERVICE_NAME: z.string().default("auth"),
    POSTGRES_PRISMA_URL: z.url().optional(),
    POSTGRES_URL_NON_POOLING: z.url().optional(),
    REDDIT_CLIENT_ID: z.string().optional(),
    REDDIT_CLIENT_SECRET: z.string().optional(),
    RESEND_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional()
    ),
    SUPPORT_EMAIL: z.email().default("hello@asocialmedia.cc"),
    TURBO_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
  },

  skipValidation: process.env.NODE_ENV === "production",
});

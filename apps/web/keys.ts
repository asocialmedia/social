import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = createEnv({
  client: {
    NEXT_PUBLIC_AUTH_URL: z.url().default("https://auth.localhost"),
    NEXT_PUBLIC_URL: z.url().default("https://social.localhost"),
  },
  runtimeEnv: {
    ASMOB_BUCKET_NAME: process.env.ASMOB_BUCKET_NAME,
    ASMOB_ENDPOINT: process.env.ASMOB_ENDPOINT,
    ASMOB_ROOT_PASSWORD: process.env.ASMOB_ROOT_PASSWORD,
    ASMOB_ROOT_USER: process.env.ASMOB_ROOT_USER,
    AUTH_INTERNAL_URL: process.env.AUTH_INTERNAL_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_TELEMETRY: process.env.BETTER_AUTH_TELEMETRY,
    DATABASE_URL: process.env.DATABASE_URL,
    KLIPY_APP_KEY: process.env.KLIPY_APP_KEY,
    LOG_LEVEL: process.env.LOG_LEVEL,
    NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
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
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    TURBO_TELEMETRY_DISABLED: process.env.TURBO_TELEMETRY_DISABLED,
  },
  server: {
    // Server-to-server auth calls should hit the auth service over the
    // private swarm/docker network instead of the public HTTPS URL. The
    // public round-trip (TLS + Cloudflare) on every page render is the main
    // driver of slow navigation. Falls back to NEXT_PUBLIC_AUTH_URL when unset.
    ASMOB_BUCKET_NAME: z.string().min(1).default("uploads"),
    ASMOB_ENDPOINT: z.url(),
    ASMOB_ROOT_PASSWORD: z.string().min(1).default("asmob-admin"),
    ASMOB_ROOT_USER: z.string().min(1).default("asmob-admin"),
    AUTH_INTERNAL_URL: z.url().optional(),
    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_TELEMETRY: z.enum(["0", "1"]).default("0"),
    DATABASE_URL: z.url(),
    KLIPY_APP_KEY: z.string().optional(),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    NEXT_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    OPENOBSERVE_LOG_STREAM: z.string().default("asm_web_logs"),
    OPENOBSERVE_METRIC_STREAM: z.string().default("asm_web_metrics"),
    OPENOBSERVE_ORG: z.string().default("default"),
    OPENOBSERVE_PASSWORD: z.string().optional(),
    OPENOBSERVE_TRACE_STREAM: z.string().default("asm_web_traces"),
    OPENOBSERVE_USER: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .url()
      .default("http://localhost:5080/api/default"),
    OTEL_SERVICE_NAME: z.string().default("web"),
    REDIS_URL: z.url(),
    SUPPORT_EMAIL: z.email().default("hello@asocialmedia.cc"),
    TURBO_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
  },

  skipValidation: process.env.NODE_ENV === "production",
});

/** biome-ignore-all lint/style/useNamingConvention: ENV VARS */
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = createEnv({
  server: {
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    ZEPHOB_ROOT_USER: z.string().min(1).default("zephob-admin"),
    ZEPHOB_ROOT_PASSWORD: z.string().min(1).default("zephob-admin"),
    ZEPHOB_BUCKET_NAME: z.string().min(1).default("uploads"),
    ZEPHOB_ENDPOINT: z.url(),
    ZEPHOB_PRODUCTION_ENDPOINT: z.url().optional(),
    ZEPHOB_ENABLE_OBJECT_LOCKING: z.enum(["on", "off"]).default("on"),
    RABBITMQ_URL: z.url().default("amqp://admin:admin123@localhost:5672"),
    MEILISEARCH_URL: z.url().default("http://localhost:7700"),
    MEILISEARCH_MASTER_KEY: z.string().default("masterKey123"),
    TIMESCALEDB_URL: z
      .url()
      .default(
        "postgresql://postgres:postgres@localhost:5434/zephyr-logs?schema=public"
      ),
    CRON_SECRET: z.string().optional(),
    CRON_SECRET_KEY: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    NEXT_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
    TURBO_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
    BETTER_AUTH_TELEMETRY: z.enum(["0", "1"]).default("0"),
    SUPPORT_EMAIL: z.email().default("hello@asocialmedia.cc"),
  },

  client: {
    NEXT_PUBLIC_PORT: z
      .string()
      .transform((val) => Number.parseInt(val, 10))
      .default(3000),
    NEXT_PUBLIC_URL: z.url().default("https://social.localhost"),
    NEXT_PUBLIC_AUTH_URL: z.url().default("https://auth.localhost"),
  },

  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    ZEPHOB_ROOT_USER: process.env.ZEPHOB_ROOT_USER,
    ZEPHOB_ROOT_PASSWORD: process.env.ZEPHOB_ROOT_PASSWORD,
    ZEPHOB_BUCKET_NAME: process.env.ZEPHOB_BUCKET_NAME,
    ZEPHOB_ENDPOINT: process.env.ZEPHOB_ENDPOINT,
    ZEPHOB_PRODUCTION_ENDPOINT: process.env.ZEPHOB_PRODUCTION_ENDPOINT,
    ZEPHOB_ENABLE_OBJECT_LOCKING: process.env.ZEPHOB_ENABLE_OBJECT_LOCKING,
    RABBITMQ_URL: process.env.RABBITMQ_URL,
    MEILISEARCH_URL: process.env.MEILISEARCH_URL,
    MEILISEARCH_MASTER_KEY: process.env.MEILISEARCH_MASTER_KEY,
    TIMESCALEDB_URL: process.env.TIMESCALEDB_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
    TURBO_TELEMETRY_DISABLED: process.env.TURBO_TELEMETRY_DISABLED,
    CRON_SECRET: process.env.CRON_SECRET,
    CRON_SECRET_KEY: process.env.CRON_SECRET_KEY,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    BETTER_AUTH_TELEMETRY: process.env.BETTER_AUTH_TELEMETRY,
    NEXT_PUBLIC_PORT: process.env.NEXT_PUBLIC_PORT,
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
  },

  skipValidation: process.env.NODE_ENV === "production",
});

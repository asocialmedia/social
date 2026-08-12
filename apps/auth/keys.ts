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
  },

  skipValidation: process.env.NODE_ENV === "production",
});

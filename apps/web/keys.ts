import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = createEnv({
  client: {
    NEXT_PUBLIC_AUTH_URL: z.url().default("https://auth.localhost"),
    NEXT_PUBLIC_PORT: z
      .string()
      .transform((val) => Math.trunc(Number(val)))
      .default(3000),
    NEXT_PUBLIC_URL: z.url().default("https://social.localhost"),
  },

  runtimeEnv: {
    ASMOB_BUCKET_NAME: process.env.ASMOB_BUCKET_NAME,
    ASMOB_ENDPOINT: process.env.ASMOB_ENDPOINT,
    ASMOB_PRODUCTION_ENDPOINT: process.env.ASMOB_PRODUCTION_ENDPOINT,
    ASMOB_ROOT_PASSWORD: process.env.ASMOB_ROOT_PASSWORD,
    ASMOB_ROOT_USER: process.env.ASMOB_ROOT_USER,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_TELEMETRY: process.env.BETTER_AUTH_TELEMETRY,
    DATABASE_URL: process.env.DATABASE_URL,
    MEILISEARCH_MASTER_KEY: process.env.MEILISEARCH_MASTER_KEY,
    MEILISEARCH_URL: process.env.MEILISEARCH_URL,
    NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
    NEXT_PUBLIC_PORT: process.env.NEXT_PUBLIC_PORT,
    NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
    NODE_ENV: process.env.NODE_ENV,
    REDIS_URL: process.env.REDIS_URL,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    TURBO_TELEMETRY_DISABLED: process.env.TURBO_TELEMETRY_DISABLED,
  },
  server: {
    ASMOB_BUCKET_NAME: z.string().min(1).default("uploads"),
    ASMOB_ENDPOINT: z.url(),
    ASMOB_PRODUCTION_ENDPOINT: z.url().optional(),
    ASMOB_ROOT_PASSWORD: z.string().min(1).default("asmob-admin"),
    ASMOB_ROOT_USER: z.string().min(1).default("asmob-admin"),
    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_TELEMETRY: z.enum(["0", "1"]).default("0"),
    DATABASE_URL: z.url(),
    MEILISEARCH_MASTER_KEY: z.string().default("masterKey123"),
    MEILISEARCH_URL: z.url().default("http://localhost:7700"),
    NEXT_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    REDIS_URL: z.url(),
    SUPPORT_EMAIL: z.email().default("hello@asocialmedia.cc"),
    TURBO_TELEMETRY_DISABLED: z.enum(["0", "1"]).default("1"),
  },

  skipValidation: process.env.NODE_ENV === "production",
});

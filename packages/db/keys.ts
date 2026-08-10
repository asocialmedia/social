import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = createEnv({
  client: {
    // No client-side env vars needed for database or Redis
  },

  runtimeEnv: {
    CHECKPOINT_DISABLE: process.env.CHECKPOINT_DISABLE,
    DATABASE_URL: process.env.DATABASE_URL,
    MEILISEARCH_MASTER_KEY: process.env.MEILISEARCH_MASTER_KEY,
    MEILISEARCH_URL: process.env.MEILISEARCH_URL,
    NODE_ENV: process.env.NODE_ENV,
    REDIS_URL: process.env.REDIS_URL,
  },
  server: {
    CHECKPOINT_DISABLE: z.coerce.number().default(1),
    DATABASE_URL: z
      .url()
      .default(
        "postgresql://postgres:postgres@localhost:5433/asocialmedia?schema=public"
      ),
    MEILISEARCH_MASTER_KEY: z.string().default("masterKey123"),
    MEILISEARCH_URL: z.url().default("http://localhost:7700"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    REDIS_URL: z.string().default("redis://:asmredis@localhost:6379/0"),
  },

  skipValidation: process.env.NODE_ENV === "production",
});

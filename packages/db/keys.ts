import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = createEnv({
  client: {
    // No client-side env vars needed for database or Redis
  },

  runtimeEnv: {
    CHECKPOINT_DISABLE: process.env.CHECKPOINT_DISABLE,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    REDIS_URL: process.env.REDIS_URL,
    VIEWER_HASH_SECRET: process.env.VIEWER_HASH_SECRET,
  },
  server: {
    CHECKPOINT_DISABLE: z.coerce.number().default(1),
    DATABASE_URL: z
      .url()
      .default(
        "postgresql://postgres:postgres@localhost:5433/asocialmedia?schema=public"
      ),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    REDIS_URL: z.string().default("redis://:asmredis@localhost:6379/0"),
    // Deployment secret that keys the anonymous viewer pseudonym hash. Changing
    // it rotates the pseudonyms; old dedup keys expire within the TTL window.
    VIEWER_HASH_SECRET: z.string().default("asm-viewer-hash-dev"),
  },

  skipValidation: process.env.NODE_ENV === "production",
});

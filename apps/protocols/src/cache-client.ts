import { createHash } from "node:crypto";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import type Redis from "ioredis";

export function createCachedBlueskyClient(
  client: BlueskyClient,
  redis?: Redis
): BlueskyClient {
  if (!redis) {
    return client;
  }

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "getPostThread") {
        return async (uri: string, depth = 3) => {
          const hash = createHash("sha256")
            .update(`${uri}:${depth}`)
            .digest("hex")
            .slice(0, 32);
          const key = `asm:protocols:cache:thread:${hash}`;
          try {
            const cached = await redis.get(key);
            if (cached) {
              return JSON.parse(cached);
            }
          } catch {
            // Redis errors should never prevent downstream reads.
          }
          const result = await target.getPostThread(uri, depth);
          if (result) {
            try {
              await redis.set(key, JSON.stringify(result), "EX", 180);
            } catch {
              // Non-blocking cache write failure.
            }
          }
          return result;
        };
      }

      if (prop === "getProfile") {
        return async (actor: string) => {
          const hash = createHash("sha256")
            .update(actor)
            .digest("hex")
            .slice(0, 32);
          const key = `asm:protocols:cache:profile:${hash}`;
          try {
            const cached = await redis.get(key);
            if (cached) {
              return JSON.parse(cached);
            }
          } catch {
            // Redis fallback
          }
          const result = await target.getProfile(actor);
          if (result) {
            try {
              await redis.set(key, JSON.stringify(result), "EX", 300);
            } catch {
              // Non-blocking
            }
          }
          return result;
        };
      }

      if (prop === "getPosts") {
        return async (uris: string[]) => {
          const sorted = [...uris].toSorted().join(",");
          const hash = createHash("sha256")
            .update(sorted)
            .digest("hex")
            .slice(0, 32);
          const key = `asm:protocols:cache:posts:${hash}`;
          try {
            const cached = await redis.get(key);
            if (cached) {
              return JSON.parse(cached);
            }
          } catch {
            // Redis fallback
          }
          const result = await target.getPosts(uris);
          if (result?.length) {
            try {
              await redis.set(key, JSON.stringify(result), "EX", 180);
            } catch {
              // Non-blocking
            }
          }
          return result;
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

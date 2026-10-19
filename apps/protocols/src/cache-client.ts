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

  let generation = 0;
  const targetInvalidations = new Map<string, number>();

  function isTargetStale(targetKey: string, startedAt: number): boolean {
    for (const [target, invalidatedAt] of targetInvalidations) {
      if (invalidatedAt >= startedAt && targetKey.includes(target)) {
        return true;
      }
    }
    return false;
  }

  const originalInvalidate =
    typeof client.invalidate === "function"
      ? client.invalidate.bind(client)
      : undefined;

  const invalidate = (target?: string) => {
    generation += 1;
    if (target) {
      targetInvalidations.set(target, Date.now());
      if (targetInvalidations.size > 1000) {
        const cutoff = Date.now() - 300_000;
        for (const [key, time] of targetInvalidations) {
          if (time < cutoff) {
            targetInvalidations.delete(key);
          }
        }
      }
    } else {
      targetInvalidations.clear();
    }
    originalInvalidate?.(target);
  };

  client.invalidate = invalidate;

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "invalidate") {
        return invalidate;
      }

      if (prop === "getPostThread") {
        return async (uri: string, depth = 3) => {
          const startedAt = Date.now();
          const readGen = generation;
          const hash = createHash("sha256")
            .update(`${uri}:${depth}`)
            .digest("hex")
            .slice(0, 32);
          const key = `asm:protocols:cache:v${readGen}:thread:${hash}`;
          try {
            const cached = await redis.get(key);
            if (cached) {
              return JSON.parse(cached);
            }
          } catch {
            // Redis errors should never prevent downstream reads.
          }
          const result = await target.getPostThread(uri, depth);
          if (
            result &&
            generation === readGen &&
            !isTargetStale(uri, startedAt)
          ) {
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
          const startedAt = Date.now();
          const readGen = generation;
          const hash = createHash("sha256")
            .update(actor)
            .digest("hex")
            .slice(0, 32);
          const key = `asm:protocols:cache:v${readGen}:profile:${hash}`;
          try {
            const cached = await redis.get(key);
            if (cached) {
              return JSON.parse(cached);
            }
          } catch {
            // Redis fallback
          }
          const result = await target.getProfile(actor);
          if (
            result &&
            generation === readGen &&
            !isTargetStale(actor, startedAt) &&
            (!result.id || !isTargetStale(result.id, startedAt))
          ) {
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
          const startedAt = Date.now();
          const readGen = generation;
          const sorted = [...uris].toSorted().join(",");
          const hash = createHash("sha256")
            .update(sorted)
            .digest("hex")
            .slice(0, 32);
          const key = `asm:protocols:cache:v${readGen}:posts:${hash}`;
          try {
            const cached = await redis.get(key);
            if (cached) {
              return JSON.parse(cached);
            }
          } catch {
            // Redis fallback
          }
          const result = await target.getPosts(uris);
          if (
            result?.length &&
            generation === readGen &&
            !uris.some((uri) => isTargetStale(uri, startedAt))
          ) {
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

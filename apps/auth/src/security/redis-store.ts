import { createLogger } from "@asm/logger";
import type IoRedis from "ioredis";

import type { AsyncRateLimitStore, RateLimitHit } from "./index";

const logger = createLogger({ serviceName: "auth-security" });

// Redis-backed rate-limit counter for the auth service's security layer.
//
// The in-memory store resets whenever the container restarts or a deploy
// rolls the binary, which hands every attacker a fresh budget at the worst
// possible moment. This store keeps the layered per-IP windows (burst,
// strict, anon/auth) in Redis so budgets survive restarts and are shared by
// every replica.
//
// Fixed-window INCR + EXPIRE, executed as one pipeline. Deliberately
// FAIL-OPEN: if Redis is unreachable the hit is allowed and the failure is
// logged, because locking every user out of sign-in during a Redis blip is
// worse than briefly losing brute-force protection.
export function createRedisRateLimitStore(
  getClient: () => IoRedis
): AsyncRateLimitStore {
  return {
    async hit(
      key: string,
      windowMs: number,
      max: number,
      now: number
    ): Promise<RateLimitHit> {
      const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
      const bucket = Math.floor(now / windowMs);
      // Bucket id is embedded in the key so counters from an expired window
      // never leak into the next one and no reset bookkeeping is needed.
      const redisKey = `authsec:${key}:${bucket}`;
      try {
        const pipeline = getClient().pipeline();
        pipeline.incr(redisKey);
        pipeline.expire(redisKey, windowSeconds + 1);
        const results = await pipeline.exec();
        const count = Number(results?.[0]?.[1] ?? 0);
        if (count <= max) {
          return { hit: false, retryAfterSeconds: 0 };
        }
        return {
          hit: true,
          retryAfterSeconds: Math.max(
            1,
            windowSeconds - Math.floor((now % windowMs) / 1000)
          ),
        };
      } catch (error) {
        // The key embeds the client IP (e.g. "anon:1.2.3.4"), so never log it
        // raw. Log only the limiter scope (the leading segment) to preserve
        // error context without leaking caller identity.
        const scope = key.split(":")[0] ?? "rate-limit";
        logger.error(
          { error, scope },
          "redis rate-limit store unavailable, failing open"
        );
        return { hit: false, retryAfterSeconds: 0 };
      }
    },
  };
}

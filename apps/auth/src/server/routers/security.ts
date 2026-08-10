import { createHash } from "node:crypto";
import { debugLog } from "@asm/config/debug";
import { redis } from "@asm/db";
import { procedure, router } from "../trpc";

function hashPII(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function executePipelineRateCheck(
  pipe: {
    incr: (k: string) => void;
    expire: (k: string, s: number) => void;
    ttl: (k: string) => void;
    exec: () => Promise<[unknown, number][]>;
  },
  primaryKey: string,
  secondaryKey: string,
  windowSeconds: number
) {
  pipe.incr(primaryKey);
  pipe.expire(primaryKey, windowSeconds);
  pipe.ttl(primaryKey);
  pipe.incr(secondaryKey);
  pipe.expire(secondaryKey, windowSeconds);
  pipe.ttl(secondaryKey);

  const results = (await pipe.exec()) as [unknown, number][] | null;
  return {
    primaryCount: Number(results?.[0]?.[1] ?? 0),
    primaryTtl: Number(results?.[2]?.[1] ?? windowSeconds),
    secondaryCount: Number(results?.[3]?.[1] ?? 0),
    secondaryTtl: Number(results?.[5]?.[1] ?? windowSeconds),
  };
}

async function executeFallbackRateCheck(
  primaryKey: string,
  secondaryKey: string,
  windowSeconds: number
) {
  const primaryCount = Number((await redis.incr(primaryKey)) || 0);
  await redis.expire(primaryKey, windowSeconds);
  const secondaryCount = Number((await redis.incr(secondaryKey)) || 0);
  await redis.expire(secondaryKey, windowSeconds);

  return {
    primaryCount,
    secondaryCount,
    primaryTtl: windowSeconds,
    secondaryTtl: windowSeconds,
  };
}

async function checkRateLimit(options: {
  primaryKey: string;
  secondaryKey: string;
  maxPerWindow: number;
  windowSeconds: number;
  logContext: string;
}): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const { primaryKey, secondaryKey, maxPerWindow, windowSeconds, logContext } =
    options;
  const multi = (redis as unknown as { multi?: () => unknown }).multi?.();
  const pipe = multi as
    | {
        incr: (k: string) => void;
        expire: (k: string, s: number) => void;
        ttl: (k: string) => void;
        exec: () => Promise<[unknown, number][]>;
      }
    | null
    | undefined;

  const result = pipe
    ? await executePipelineRateCheck(
        pipe,
        primaryKey,
        secondaryKey,
        windowSeconds
      )
    : await executeFallbackRateCheck(primaryKey, secondaryKey, windowSeconds);

  debugLog.api(`${logContext}:rate-check${pipe ? "" : "-fallback"}`, {
    primaryCount: result.primaryCount,
    secondaryCount: result.secondaryCount,
  });

  if (
    result.primaryCount > maxPerWindow ||
    result.secondaryCount > maxPerWindow
  ) {
    const retryAfter = Math.max(
      1,
      Math.min(result.primaryTtl, result.secondaryTtl)
    );
    return { ok: false, retryAfter };
  }

  return { ok: true };
}

const LOGOUT_RATE_PREFIX = "rate:logout:";
const LOGOUT_RATE_WINDOW_SECONDS = 60 * 5;
const LOGOUT_MAX_PER_WINDOW = 10;
const LOGOUT_AUDIT_PREFIX = "audit:logout:";

const RESET_PASSWORD_RATE_PREFIX = "rate:reset-password:";
const RESET_PASSWORD_RATE_WINDOW_SECONDS = 60 * 15;
const RESET_PASSWORD_MAX_PER_WINDOW = 3;
const RESET_PASSWORD_AUDIT_PREFIX = "audit:reset-password:";

function checkLogoutRateLimit(
  userId: string,
  ip: string
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const userKey = `${LOGOUT_RATE_PREFIX}user:${userId}`;
  const ipKey = `${LOGOUT_RATE_PREFIX}ip:${hashPII(ip)}`;

  return checkRateLimit({
    primaryKey: userKey,
    secondaryKey: ipKey,
    maxPerWindow: LOGOUT_MAX_PER_WINDOW,
    windowSeconds: LOGOUT_RATE_WINDOW_SECONDS,
    logContext: "logout",
  });
}

async function auditLogout(options: {
  userId: string;
  ip: string;
  userAgent: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { userId, ip, userAgent, reason, metadata = {} } = options;
  const auditKey = `${LOGOUT_AUDIT_PREFIX}${userId}:${Date.now()}`;
  const auditData = {
    userId,
    ip,
    userAgent,
    reason,
    timestamp: new Date().toISOString(),
    ...metadata,
  };

  try {
    await redis.setex(auditKey, 60 * 60 * 24 * 30, JSON.stringify(auditData));
    debugLog.api("logout:audit", auditData);
  } catch (error) {
    debugLog.api("logout:audit-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function checkResetPasswordRateLimit(
  identifier: string,
  ip: string
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const identifierKey = `${RESET_PASSWORD_RATE_PREFIX}identifier:${hashPII(identifier)}`;
  const ipKey = `${RESET_PASSWORD_RATE_PREFIX}ip:${hashPII(ip)}`;

  return checkRateLimit({
    primaryKey: identifierKey,
    secondaryKey: ipKey,
    maxPerWindow: RESET_PASSWORD_MAX_PER_WINDOW,
    windowSeconds: RESET_PASSWORD_RATE_WINDOW_SECONDS,
    logContext: "reset-password",
  });
}

async function auditResetPassword(options: {
  identifier: string;
  ip: string;
  userAgent: string | null;
  success: boolean;
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { identifier, ip, userAgent, success, userId, metadata = {} } = options;
  const auditKey = `${RESET_PASSWORD_AUDIT_PREFIX}${Date.now()}:${identifier}`;
  const auditData = {
    identifier,
    ip,
    userAgent,
    success,
    userId,
    timestamp: new Date().toISOString(),
    ...metadata,
  };

  try {
    await redis.setex(auditKey, 60 * 60 * 24 * 30, JSON.stringify(auditData)); // 30 days
    debugLog.api("reset-password:audit", auditData);
  } catch (error) {
    debugLog.api("reset-password:audit-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export {
  auditLogout,
  auditResetPassword,
  checkLogoutRateLimit,
  checkResetPasswordRateLimit,
};

export const securityRouter = router({
  securityHealth: procedure.query(() => ({
    status: "healthy",
    timestamp: new Date().toISOString(),
    rateLimits: {
      logoutMaxPerWindow: LOGOUT_MAX_PER_WINDOW,
      logoutWindowSeconds: LOGOUT_RATE_WINDOW_SECONDS,
      resetPasswordMaxPerWindow: RESET_PASSWORD_MAX_PER_WINDOW,
      resetPasswordWindowSeconds: RESET_PASSWORD_RATE_WINDOW_SECONDS,
    },
  })),
});

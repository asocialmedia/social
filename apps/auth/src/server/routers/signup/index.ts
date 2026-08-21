import { randomUUID } from "node:crypto";

import { hashPasswordWithScrypt } from "@asm/auth/core";
import { debugLog } from "@asm/config/debug";
import { isReservedUsername, prisma, redis } from "@asm/db";
import { createLogger } from "@asm/logger";
import { z } from "zod";

import { auth } from "@/auth/config";
import { sendVerificationOTP } from "@/email/service";
import { getClientIpFromHeaders } from "@/security/client-ip";

import { procedure, router } from "../../trpc";
import { emailRouter } from "../email";

const logger = createLogger({ serviceName: "auth-signup" });

const PENDING_PREFIX = "pending-signup:";

// Redact the local part of an email in logs (keep the domain for correlation).
function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) {
    return email.length > 2 ? `${email.slice(0, 1)}***` : "***";
  }
  const head = local.length > 1 ? local.slice(0, 1) : local;
  return `${head}***@${domain}`;
}
const PENDING_TTL_SECONDS = 60 * 60 * 2;
const RATE_PREFIX = "rate:signup:";
const RATE_GLOBAL_WINDOW_SECONDS = 60 * 15;
const RATE_GLOBAL_MAX_ATTEMPTS = 8;
const RATE_ACTION_WINDOW_SECONDS = 60 * 5;
const RATE_MAX_START_PER_WINDOW = 6;
const RATE_MAX_RESEND_PER_WINDOW = 3;
// Verify is the OTP brute-force surface: a 6-digit space (10^6) must never
// allow sustained guessing. A tight per-email+per-IP cap plus a hard lockout
// (below) bounds a window to a handful of attempts.
const RATE_MAX_VERIFY_PER_WINDOW = 5;
// Failed attempts per email before the code is consumed and further guesses
// are rejected without touching the database.
const VERIFY_MAX_FAILURES_PER_EMAIL = 5;
const VERIFY_FAILURE_WINDOW_SECONDS = 60 * 10;
const RATE_CREATION_WINDOW_SECONDS = 60 * 60;
const RATE_MAX_CREATIONS_PER_WINDOW = 3;

async function cleanupExpiredVerifications(): Promise<void> {
  try {
    const result = await prisma.verification.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    if (result.count > 0) {
      debugLog.api("cleanup:expired-verifications", { count: result.count });
      console.log(`Cleaned up ${result.count} expired verification records`);
    }
  } catch (error) {
    console.error("Failed to cleanup expired verifications:", error);
  }
}

async function consumeVerificationCodes(emailLower: string): Promise<void> {
  try {
    const betterAuthIdentifier = `email-verification-otp-${emailLower}`;
    await prisma.verification.deleteMany({
      where: {
        OR: [
          {
            identifier: {
              equals: betterAuthIdentifier,
              mode: "insensitive",
            },
          },
          { identifier: { equals: emailLower, mode: "insensitive" } },
        ],
      },
    });
    debugLog.api("verifyEmailOtp:codes-consumed", {
      email: redactEmail(emailLower),
    });
  } catch (cleanupError) {
    console.error("Failed to consume OTP records:", cleanupError);
  }
}

// Atomically increments the per-email failure counter and returns the new
// count. A plain read-then-write loses updates when wrong guesses overlap,
// letting more guesses through than the budget allows; INCR + EXPIRE in one
// pipeline keeps the count exact under concurrency.
async function countVerifyFailure(emailLower: string): Promise<number> {
  const key = `${RATE_PREFIX}verifyfail:${emailLower}`;
  try {
    const multi = redis.multi();
    multi.incr(key);
    multi.expire(key, VERIFY_FAILURE_WINDOW_SECONDS);
    const results = await multi.exec();
    if (!results) {
      return 1;
    }
    return Number(results[0]?.[1] ?? 1);
  } catch (error) {
    debugLog.api("verifyEmailOtp:fail-counter-error", {
      email: redactEmail(emailLower),
      error: String(error),
    });
    // Fail open on counter errors; the request-level verify rate limit still
    // bounds guessing.
    return 1;
  }
}

async function clearVerifyFailures(emailLower: string): Promise<void> {
  try {
    await redis.del(`${RATE_PREFIX}verifyfail:${emailLower}`);
  } catch {
    // Non-fatal
  }
}

// Returns "valid" for a correct code, "invalid" for a wrong or expired code
// and "locked" when the per-email failure budget is exhausted (the code is
// consumed so a resend is required). Wrong guesses only count against the
// budget when a live code actually exists for the email, so an anonymous
// caller cannot freeze a pending signup with random guesses.
async function verifyEmailOtp(
  emailLower: string,
  otp: string
): Promise<"valid" | "invalid" | "locked"> {
  const failKey = `${RATE_PREFIX}verifyfail:${emailLower}`;
  try {
    const failures = Number((await redis.get(failKey)) ?? 0);
    if (failures >= VERIFY_MAX_FAILURES_PER_EMAIL) {
      await consumeVerificationCodes(emailLower);
      debugLog.api("verifyEmailOtp:locked", {
        email: redactEmail(emailLower),
      });
      return "locked";
    }
  } catch {
    // Fail-open on counter errors: the request-level verify rate limit still
    // bounds guessing.
  }

  const betterAuthIdentifier = `email-verification-otp-${emailLower}`;
  try {
    await prisma.verification.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        identifier: { equals: betterAuthIdentifier, mode: "insensitive" },
      },
    });
  } catch (cleanupError) {
    console.error("Failed to cleanup expired OTPs:", cleanupError);
  }

  const allVerifications = await prisma.verification.findMany({
    select: { expiresAt: true, id: true, identifier: true, value: true },
    where: {
      expiresAt: { gte: new Date() },
      identifier: { equals: betterAuthIdentifier, mode: "insensitive" },
    },
  });

  debugLog.api("verifyEmailOtp:lookup", {
    email: redactEmail(emailLower),
    recordCount: allVerifications.length,
  });

  const v = allVerifications.find((record) => {
    const [storedOtp] = record.value.split(":");
    return storedOtp === otp;
  });

  if (!v) {
    // Never log the guessed OTP or the raw address.
    debugLog.api("verifyEmailOtp:not-found", {
      email: redactEmail(emailLower),
    });
    // Only count a failure when a live code existed for this email, so a
    // caller cannot freeze a pending signup with random guesses. The counter
    // increment is atomic; once the budget is exhausted the code is consumed.
    if (allVerifications.length > 0) {
      const failures = await countVerifyFailure(emailLower);
      if (failures >= VERIFY_MAX_FAILURES_PER_EMAIL) {
        await consumeVerificationCodes(emailLower);
      }
    }
    return "invalid";
  }

  if (v.expiresAt < new Date()) {
    debugLog.api("verifyEmailOtp:expired", {
      email: redactEmail(emailLower),
      expiresAt: v.expiresAt,
    });
    return "invalid";
  }

  await clearVerifyFailures(emailLower);
  // Never log the OTP itself.
  debugLog.api("verifyEmailOtp:valid", { email: redactEmail(emailLower) });
  return "valid";
}

/**
 * Generate and send a signup verification OTP. The signup flow stores a
 * pending signup in Redis before the DB user exists, but Better Auth's
 * /email-otp/send-verification-otp silently skips sending when the user
 * is not found in the database. Instead, create the OTP with the
 * server-only createVerificationOTP (which stores it in the verification
 * table in Better Auth's format) and send it via Resend directly.
 */
async function sendSignupVerificationOTP(email: string): Promise<boolean> {
  try {
    const otp = await auth.api.createVerificationOTP({
      body: {
        email,
        type: "email-verification",
      },
    });

    const result = await sendVerificationOTP(email, otp);
    debugLog.api("sendSignupVerificationOTP:result", {
      email: redactEmail(email),
      error: result.error,
      success: result.success,
    });
    logger.info(
      {
        email: redactEmail(email),
        error: result.error,
        success: result.success,
      },
      "signup verification otp"
    );

    return result.success;
  } catch (otpError) {
    debugLog.api("sendSignupVerificationOTP:error", {
      email: redactEmail(email),
      error: otpError instanceof Error ? otpError.message : String(otpError),
    });
    logger.error(
      {
        email: redactEmail(email),
        error: otpError instanceof Error ? otpError.message : String(otpError),
      },
      "signup verification otp failed"
    );
    return false;
  }
}

// Shared trusted-ingress policy: cf-connecting-ip first (Cloudflare always
// overwrites it), then the LAST x-forwarded-for entry, which the web app sets
// from its own trusted ingress. Client-supplied leading XFF entries are never
// trusted, so a caller cannot rotate them to evade per-IP budgets.
function getIpFromHeaders(headers: Headers | undefined): string {
  return getClientIpFromHeaders(headers);
}

async function getPendingSignupData(input: {
  token?: string;
  email?: string;
  otp?: string;
  otpVerified?: boolean;
}): Promise<{ data: PendingSignup | null; key: string | null }> {
  if (!input.token) {
    return { data: null, key: null };
  }

  const key = `${PENDING_PREFIX}${input.token}`;
  const raw = await redis.get(key);
  debugLog.api("pendingSignupVerify:redis-get", { found: Boolean(raw) });
  if (!raw) {
    return { data: null, key: null };
  }

  try {
    const data = JSON.parse(raw) as PendingSignup;
    return { data, key };
  } catch {
    debugLog.api("pendingSignupVerify:parse-error");
    return { data: null, key: null };
  }
}

async function checkRateLimit(
  kind: "start" | "resend" | "verify" | "create",
  ip: string,
  emailLower: string
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const now = Math.floor(Date.now() / 1000);
  const globalIpKey = `${RATE_PREFIX}global:ip:${ip}`;
  const globalEmailKey = `${RATE_PREFIX}global:email:${emailLower}`;
  const actionIpKey = `${RATE_PREFIX}${kind}:ip:${ip}`;
  const actionEmailKey = `${RATE_PREFIX}${kind}:email:${emailLower}`;

  try {
    const multi = redis.multi();
    multi.incr(globalIpKey);
    multi.expire(globalIpKey, RATE_GLOBAL_WINDOW_SECONDS);
    multi.incr(globalEmailKey);
    multi.expire(globalEmailKey, RATE_GLOBAL_WINDOW_SECONDS);
    multi.incr(actionIpKey);
    multi.expire(actionIpKey, RATE_ACTION_WINDOW_SECONDS);
    multi.incr(actionEmailKey);
    multi.expire(actionEmailKey, RATE_ACTION_WINDOW_SECONDS);
    multi.ttl(globalIpKey);

    const results = await multi.exec();

    if (!results) {
      debugLog.api("rate:redis-error", { emailLower, ip, kind });
      return { allowed: false, remaining: 0, resetTime: now + 60 };
    }

    const globalIpCount = Number(results[0]?.[1] ?? 0);
    const globalEmailCount = Number(results[2]?.[1] ?? 0);
    const actionIpCount = Number(results[4]?.[1] ?? 0);
    const actionEmailCount = Number(results[6]?.[1] ?? 0);
    const ttl = Number(results[8]?.[1] ?? RATE_GLOBAL_WINDOW_SECONDS);
    const globalIpAllowed = globalIpCount <= RATE_GLOBAL_MAX_ATTEMPTS;
    const globalEmailAllowed = globalEmailCount <= RATE_GLOBAL_MAX_ATTEMPTS;

    if (!(globalIpAllowed && globalEmailAllowed)) {
      const resetTime = now + ttl;
      debugLog.api(`rate:global-exceeded:${kind}`, {
        emailLower,
        globalEmailCount,
        globalIpCount,
        ip,
        resetTime,
      });
      return { allowed: false, remaining: 0, resetTime };
    }

    let actionMax = RATE_MAX_RESEND_PER_WINDOW;
    if (kind === "start") {
      actionMax = RATE_MAX_START_PER_WINDOW;
    } else if (kind === "verify") {
      actionMax = RATE_MAX_VERIFY_PER_WINDOW;
    }
    const actionIpAllowed = actionIpCount <= actionMax;
    const actionEmailAllowed = actionEmailCount <= actionMax;

    if (!(actionIpAllowed && actionEmailAllowed)) {
      const resetTime = now + RATE_ACTION_WINDOW_SECONDS;
      debugLog.api(`rate:action-exceeded:${kind}`, {
        actionEmailCount,
        actionIpCount,
        emailLower,
        ip,
        resetTime,
      });
      return { allowed: false, remaining: 0, resetTime };
    }

    const globalRemaining = Math.max(
      0,
      RATE_GLOBAL_MAX_ATTEMPTS - Math.max(globalIpCount, globalEmailCount)
    );
    const actionRemaining = Math.max(
      0,
      actionMax - Math.max(actionIpCount, actionEmailCount)
    );
    const remaining = Math.min(globalRemaining, actionRemaining);

    debugLog.api(`rate:allowed:${kind}`, {
      actionEmailCount,
      actionIpCount,
      emailLower,
      globalEmailCount,
      globalIpCount,
      ip,
      remaining,
    });

    return { allowed: true, remaining, resetTime: now + ttl };
  } catch (error) {
    debugLog.api("rate:error", { emailLower, error: String(error), ip, kind });
    return { allowed: false, remaining: 0, resetTime: now + 60 };
  }
}

async function checkAccountCreationRateLimit(
  ip: string,
  emailLower: string
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const now = Math.floor(Date.now() / 1000);

  const ipKey = `${RATE_PREFIX}creation:ip:${ip}`;
  const emailKey = `${RATE_PREFIX}creation:email:${emailLower}`;

  try {
    const multi = redis.multi();
    multi.incr(ipKey);
    multi.expire(ipKey, RATE_CREATION_WINDOW_SECONDS);
    multi.incr(emailKey);
    multi.expire(emailKey, RATE_CREATION_WINDOW_SECONDS);
    multi.ttl(ipKey);

    const results = await multi.exec();

    if (!results) {
      return { allowed: false, remaining: 0, resetTime: now + 60 };
    }

    const ipCount = Number(results[0]?.[1] ?? 0);
    const emailCount = Number(results[2]?.[1] ?? 0);
    const ttl = Number(results[4]?.[1] ?? RATE_CREATION_WINDOW_SECONDS);

    const ipAllowed = ipCount <= RATE_MAX_CREATIONS_PER_WINDOW;
    const emailAllowed = emailCount <= RATE_MAX_CREATIONS_PER_WINDOW;

    if (!(ipAllowed && emailAllowed)) {
      const resetTime = now + ttl;
      debugLog.api("rate:creation-exceeded", {
        emailCount,
        emailLower,
        ip,
        ipCount,
        resetTime,
      });
      return { allowed: false, remaining: 0, resetTime };
    }

    const remaining = Math.max(
      0,
      RATE_MAX_CREATIONS_PER_WINDOW - Math.max(ipCount, emailCount)
    );
    return { allowed: true, remaining, resetTime: now + ttl };
  } catch (error) {
    debugLog.api("rate:creation-error", {
      emailLower,
      error: String(error),
      ip,
    });
    return { allowed: false, remaining: 0, resetTime: now + 60 };
  }
}

interface ExistingSignupUser {
  email: string | null;
  id: string;
  passwordHash: string | null;
  username: string;
}

async function findExistingSignupUser(
  emailLower: string,
  username: string
): Promise<ExistingSignupUser | null> {
  return await prisma.user.findFirst({
    select: {
      email: true,
      id: true,
      passwordHash: true,
      username: true,
    },
    where: {
      OR: [
        { email: { equals: emailLower, mode: "insensitive" } },
        { username: { equals: username, mode: "insensitive" } },
      ],
    },
  });
}

function userExistsResponse() {
  return {
    error: "user-exists",
    message:
      "An account with this email or username already exists. Try logging in or use Forgot Password.",
    success: false,
  } as const;
}

async function writePendingSignup(
  token: string,
  payload: PendingSignup
): Promise<void> {
  const key = `${PENDING_PREFIX}${token}`;
  const emailKey = `${PENDING_PREFIX}email:${payload.email.toLowerCase()}`;
  await redis.set(key, JSON.stringify(payload), "EX", PENDING_TTL_SECONDS);
  await redis.set(emailKey, token, "EX", PENDING_TTL_SECONDS);
  debugLog.api("pending:redis-set", {
    emailKey,
    key,
    ttl: PENDING_TTL_SECONDS,
  });
}

async function _sendVerificationEmailSafe(
  email: string,
  token: string
): Promise<void> {
  try {
    const { sendVerificationEmail } = await import("@/email/service");
    await sendVerificationEmail(email, token);
    debugLog.api("pending:email-sent");
  } catch (error) {
    debugLog.api("pending:email-send-fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

interface PendingSignup {
  displayName: string;
  email: string;
  password: string;
  passwordHash: string;
  username: string;
}

export const signupRouter = router({
  email: emailRouter,

  pendingSignupResend: procedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      debugLog.api("pendingSignupResend:begin", {
        email: redactEmail(input.email),
      });
      const ip = getIpFromHeaders(ctx?.req?.headers as Headers | undefined);
      const rateCheck = await checkRateLimit(
        "resend",
        ip,
        input.email.toLowerCase()
      );
      if (!rateCheck.allowed) {
        return {
          error: "rate-limited",
          remaining: rateCheck.remaining,
          resetTime: rateCheck.resetTime,
          success: false,
        } as const;
      }
      const emailKey = `${PENDING_PREFIX}email:${input.email.toLowerCase()}`;
      const token = await redis.get(emailKey);
      debugLog.api("pendingSignupResend:lookup", { found: Boolean(token) });
      if (!token) {
        // Uniform response: whether or not a pending signup exists, the caller
        // sees success so the endpoint cannot be used as an existence oracle.
        return { success: true } as const;
      }
      try {
        const otpSent = await sendSignupVerificationOTP(input.email);

        if (!otpSent) {
          throw new Error("OTP send failed");
        }

        debugLog.api("pendingSignupResend:otp-sent");
      } catch (otpError) {
        debugLog.api("pendingSignupResend:otp-error", {
          error:
            otpError instanceof Error ? otpError.message : String(otpError),
        });
        try {
          const { sendVerificationEmail } = await import("@/email/service");
          await sendVerificationEmail(input.email, token);
          debugLog.api("pendingSignupResend:fallback-email-sent");
        } catch (emailError) {
          console.error("pendingSignupResend:email-error", emailError);
        }
      }
      return { success: true } as const;
    }),

  pendingSignupSendLink: procedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      debugLog.api("pendingSignupSendLink:begin", {
        email: redactEmail(input.email),
      });
      const emailLower = input.email.toLowerCase();

      const reqHeaders = ctx?.req?.headers as Headers | undefined;
      const ip = getClientIpFromHeaders(reqHeaders);
      const rateCheck = await checkRateLimit("resend", ip, emailLower);
      if (!rateCheck.allowed) {
        return {
          error: "rate-limited",
          remaining: rateCheck.remaining,
          resetTime: rateCheck.resetTime,
          success: false,
        } as const;
      }

      const emailKey = `${PENDING_PREFIX}email:${emailLower}`;
      const token = await redis.get(emailKey);
      if (!token) {
        // Uniform response: never reveal whether a pending signup exists.
        return { success: true } as const;
      }
      try {
        await _sendVerificationEmailSafe(emailLower, token);
        debugLog.api("pendingSignupSendLink:sent");
        return { success: true } as const;
      } catch (error) {
        debugLog.api("pendingSignupSendLink:error", {
          message: error instanceof Error ? error.message : String(error),
        });
        return { error: "server-error", success: false } as const;
      }
    }),

  pendingSignupStart: procedure
    .input(
      z.object({
        displayName: z.string().min(1).max(64),
        email: z.email(),
        password: z.string().min(8),
        username: z.string().min(3).max(32),
      })
    )
    .mutation(async ({ input, ctx }) => {
      debugLog.api("pendingSignupStart:begin", {
        email: redactEmail(input.email),
        username: input.username,
      });
      try {
        const ip = getIpFromHeaders(ctx?.req?.headers as Headers | undefined);
        const rateCheck = await checkRateLimit(
          "start",
          ip,
          input.email.toLowerCase()
        );
        if (!rateCheck.allowed) {
          return {
            error: "rate-limited",
            remaining: rateCheck.remaining,
            resetTime: rateCheck.resetTime,
            success: false,
          } as const;
        }

        const existingUser = await findExistingSignupUser(
          input.email,
          input.username
        );
        debugLog.api("pendingSignupStart:existing", {
          exists: Boolean(existingUser),
          userId: existingUser?.id,
        });
        if (existingUser) {
          return userExistsResponse();
        }

        // Reserved handles (the "zeph" moderation persona) can never be claimed
        // by a real account. Treat them like an existing username so the signup
        // fails with the same "already exists" message instead of revealing the
        // reservation.
        if (isReservedUsername(input.username)) {
          return userExistsResponse();
        }

        const creationRateCheck = await checkAccountCreationRateLimit(
          ip,
          input.email.toLowerCase()
        );
        if (!creationRateCheck.allowed) {
          debugLog.api("pendingSignupStart:creation-rate-limited", {
            email: input.email,
            ip,
          });
          return {
            error: "rate-limited",
            remaining: creationRateCheck.remaining,
            resetTime: creationRateCheck.resetTime,
            success: false,
          } as const;
        }

        const hashedPassword = await hashPasswordWithScrypt(input.password);
        debugLog.api("pendingSignupStart:hash-done");

        const token = randomUUID();
        const payload: PendingSignup = {
          displayName: input.displayName,
          email: input.email,
          password: input.password,
          passwordHash: hashedPassword,
          username: input.username,
        };

        await writePendingSignup(token, payload);

        try {
          const otpSent = await sendSignupVerificationOTP(input.email);

          if (!otpSent) {
            debugLog.api("pendingSignupStart:otp-send-failed", {
              email: input.email,
            });
          }
        } catch (otpError) {
          debugLog.api("pendingSignupStart:otp-error", {
            error:
              otpError instanceof Error ? otpError.message : String(otpError),
          });
          debugLog.api("pendingSignupStart:otp-send-failed", {
            email: input.email,
            error:
              otpError instanceof Error ? otpError.message : String(otpError),
          });
        }

        debugLog.api("pendingSignupStart:done");
        return { requiresEmailVerification: true, success: true } as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog.api("pendingSignupStart:error", { message });
        console.error("pendingSignupStart:error", message);
        return { error: "server-error", success: false } as const;
      }
    }),

  pendingSignupVerify: procedure
    .input(
      z.union([
        z.object({ token: z.string().min(1) }),
        z.object({
          email: z.email(),
          otp: z.string().min(6),
          otpVerified: z.literal(true),
        }),
      ])
    )
    .mutation(async ({ input, ctx }) => {
      debugLog.api("pendingSignupVerify:begin");
      const ip = getIpFromHeaders(ctx?.req?.headers as Headers | undefined);

      if ("otpVerified" in input && input.email && input.otp) {
        debugLog.api("pendingSignupVerify:otp-verification-start");
        void cleanupExpiredVerifications();

        const emailLower = input.email.toLowerCase();
        const rateCheck = await checkRateLimit("verify", ip, emailLower);
        if (!rateCheck.allowed) {
          return {
            error: "rate-limited",
            remaining: rateCheck.remaining,
            resetTime: rateCheck.resetTime,
            success: false,
          } as const;
        }

        const otpStatus = await verifyEmailOtp(emailLower, input.otp);
        if (otpStatus !== "valid") {
          return { error: "invalid-otp", success: false } as const;
        }

        const emailKey = `${PENDING_PREFIX}email:${input.email.toLowerCase()}`;
        const token = await redis.get(emailKey);
        if (!token) {
          return { error: "no-pending-signup", success: false } as const;
        }

        const pendingKey = `${PENDING_PREFIX}${token}`;
        const raw = await redis.get(pendingKey);
        if (!raw) {
          return { error: "no-pending-signup", success: false } as const;
        }

        try {
          const pendingData = JSON.parse(raw) as PendingSignup;

          if (pendingData.email.toLowerCase() !== input.email.toLowerCase()) {
            debugLog.api("pendingSignupVerify:email-mismatch");
            return { error: "invalid-request", success: false } as const;
          }

          const existing = await prisma.user.findFirst({
            select: { id: true },
            where: {
              OR: [
                { email: { equals: pendingData.email, mode: "insensitive" } },
                {
                  username: {
                    equals: pendingData.username,
                    mode: "insensitive",
                  },
                },
              ],
            },
          });
          debugLog.api("pendingSignupVerify:existing", {
            exists: Boolean(existing),
          });
          if (existing) {
            await redis.del(pendingKey);
            return { error: "user-exists", success: false } as const;
          }

          try {
            const pendingEmailLower = input.email.toLowerCase();
            const betterAuthIdentifier = `email-verification-otp-${pendingEmailLower}`;
            const deletedCount = await prisma.verification.deleteMany({
              where: {
                OR: [
                  {
                    identifier: {
                      equals: betterAuthIdentifier,
                      mode: "insensitive",
                    },
                  },
                  {
                    identifier: {
                      equals: pendingEmailLower,
                      mode: "insensitive",
                    },
                  },
                ],
              },
            });
            debugLog.api("pendingSignupVerify:otp-cleaned-up", {
              deletedCount: deletedCount.count,
            });
            console.log(
              `Cleaned up ${deletedCount.count} OTP records for ${redactEmail(emailLower)}`
            );
          } catch (cleanupError) {
            console.error("Failed to cleanup OTP records:", cleanupError);
            debugLog.api("pendingSignupVerify:otp-cleanup-failed", {
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
            });
          }

          // Reserved handles (the "zeph" moderation persona) can never be
          // claimed, even from a pending signup created before the reservation
          // existed. Clean up the pending key and fail like a taken username.
          if (isReservedUsername(pendingData.username)) {
            await redis.del(pendingKey);
            return { error: "user-exists", success: false } as const;
          }

          const user = await prisma.user.create({
            data: {
              displayName: pendingData.displayName,
              displayUsername: pendingData.username,
              email: pendingData.email,
              emailVerified: true,
              emailVerifiedAt: new Date(),
              passwordHash: pendingData.passwordHash,
              role: "user",
              username: pendingData.username,
            },
            select: { id: true },
          });
          debugLog.api("pendingSignupVerify:user-created", { userId: user.id });

          try {
            const pendingEmailLower = pendingData.email.toLowerCase();
            const passwordObj = JSON.stringify({
              hash: pendingData.passwordHash,
            });

            await prisma.account.create({
              data: {
                accountId: pendingEmailLower,
                password: passwordObj,
                providerId: "email",
                userId: user.id,
              },
            });

            await prisma.account
              .create({
                data: {
                  accountId: pendingEmailLower,
                  password: passwordObj,
                  providerId: "credential",
                  userId: user.id,
                },
              })
              .catch(() => {
                /* ignore errors, account might already exist */
              });
            debugLog.api("pendingSignupVerify:account-created");
          } catch (error) {
            debugLog.api("pendingSignupVerify:account-create-error", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          await redis.del(pendingKey);
          debugLog.api("pendingSignupVerify:redis-del");

          return {
            email: pendingData.email,
            success: true,
            userId: user.id,
          } as const;
        } catch {
          debugLog.api("pendingSignupVerify:parse-error");
          return { error: "no-pending-signup", success: false } as const;
        }
      }

      const { data, key } = await getPendingSignupData(input);

      if (!(data && key)) {
        const errorType = "invalid-token";
        return { error: errorType, success: false } as const;
      }

      const existing = await prisma.user.findFirst({
        select: { id: true },
        where: {
          OR: [
            { email: { equals: data.email, mode: "insensitive" } },
            { username: { equals: data.username, mode: "insensitive" } },
          ],
        },
      });
      debugLog.api("pendingSignupVerify:existing", {
        exists: Boolean(existing),
      });
      if (existing) {
        await redis.del(key);
        return { error: "user-exists", success: false } as const;
      }

      // Reserved handles (the "zeph" moderation persona) can never be claimed,
      // even from a pending signup created before the reservation existed.
      // Clean up the pending key and fail like a taken username.
      if (isReservedUsername(data.username)) {
        await redis.del(key);
        return { error: "user-exists", success: false } as const;
      }

      const user = await prisma.user.create({
        data: {
          displayName: data.displayName,
          displayUsername: data.username,
          email: data.email,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          passwordHash: data.passwordHash,
          role: "user",
          username: data.username,
        },
        select: { id: true },
      });
      debugLog.api("pendingSignupVerify:user-created", { userId: user.id });

      try {
        const emailLower = data.email.toLowerCase();
        const password = data.passwordHash;

        await prisma.account.create({
          data: {
            accountId: emailLower,
            password,
            providerId: "email",
            userId: user.id,
          },
        });

        await prisma.account
          .create({
            data: {
              accountId: emailLower,
              password,
              providerId: "credential",
              userId: user.id,
            },
          })
          .catch(() => {
            /* ignore errors, account might already exist */
          });
        debugLog.api("pendingSignupVerify:account-created");
      } catch (error) {
        debugLog.api("pendingSignupVerify:account-exists-or-error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await redis.del(key);
      debugLog.api("pendingSignupVerify:redis-del");

      try {
        const emailLower = data.email.toLowerCase();
        const betterAuthIdentifier = `email-verification-otp-${emailLower}`;
        const deletedCount = await prisma.verification.deleteMany({
          where: {
            OR: [
              {
                identifier: {
                  equals: betterAuthIdentifier,
                  mode: "insensitive",
                },
              },
              { identifier: { equals: emailLower, mode: "insensitive" } },
            ],
          },
        });
        debugLog.api("pendingSignupVerify:otp-cleaned-up-link-path", {
          deletedCount: deletedCount.count,
        });
        console.log(
          `Cleaned up ${deletedCount.count} OTP records for ${redactEmail(emailLower)} (link path)`
        );
      } catch (cleanupError) {
        console.error("Failed to cleanup OTP records:", cleanupError);
        debugLog.api("pendingSignupVerify:otp-cleanup-failed-link-path", {
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }

      return {
        email: data.email,
        password: data.password,
        success: true,
        userId: user.id,
      } as const;
    }),
});

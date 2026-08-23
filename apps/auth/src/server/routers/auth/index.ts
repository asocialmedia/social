import { hybridSessionStore } from "@asm/auth/core";
import { debugLog } from "@asm/config/debug";
import { prisma } from "@asm/db";
import { z } from "zod";

import { procedure, protectedProcedure, router } from "../../trpc";
import { auditLogout, checkLogoutRateLimit } from "../security";

export const authRouter = router({
  generateToken: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    // Fail closed rather than signing with a public fallback constant.
    const secretValue = process.env.NEXTAUTH_SECRET;
    if (!secretValue) {
      throw new Error("JWT secret not configured");
    }
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(secretValue);

    const token = await new SignJWT({
      email: ctx.user.email,
      name: ctx.user.name,
      sub: userId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .setIssuer(process.env.APP_URL || "https://social.localhost")
      .setAudience(process.env.APP_URL || "https://social.localhost")
      .sign(secret);

    return { token };
  }),

  logout: protectedProcedure
    .input(
      z.object({
        clientMetadata: z
          .object({
            deviceId: z.string().optional(),
            location: z.string().optional(),
            userAgent: z.string().optional(),
          })
          .optional(),
        force: z.boolean().optional().default(false),
        reason: z
          .enum([
            "user-initiated",
            "security-concern",
            "session-expiry",
            "account-deletion",
            "admin-action",
          ])
          .optional()
          .default("user-initiated"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      const userId = ctx.user.id;
      const ip = getClientIpFromHeaders(
        ctx?.req?.headers as Headers | undefined
      );
      const userAgent =
        (ctx?.req?.headers as Headers | undefined)?.get?.("user-agent") || null;

      debugLog.api("logout:initiated", {
        force: input.force,
        ip,
        reason: input.reason,
        userId,
      });

      try {
        // 1. RATE LIMITING CHECK
        const rateCheck = await checkLogoutRateLimit(userId, ip);
        if (!rateCheck.ok) {
          await auditLogout({
            ip,
            metadata: {
              originalReason: input.reason,
              retryAfter: rateCheck.retryAfter,
            },
            reason: "rate-limited",
            userAgent,
            userId,
          });

          return {
            error: "rate-limited",
            retryAfter: rateCheck.retryAfter,
            success: false,
          } as const;
        }

        // 2. VALIDATE USER SESSION INTEGRITY
        const currentSession = await prisma.session.findFirst({
          orderBy: { createdAt: "desc" },
          select: { expiresAt: true, id: true, token: true },
          where: {
            expiresAt: { gt: new Date() },
            userId,
          },
        });

        if (!currentSession) {
          await auditLogout({
            ip,
            metadata: {
              force: input.force,
              originalReason: input.reason,
            },
            reason: "no-active-session",
            userAgent,
            userId,
          });

          return {
            error: "no-active-session",
            success: false,
          } as const;
        }

        // 3. CLEAR REDIS SESSIONS (Hybrid Session Store)
        debugLog.api("logout:clearing-redis", { userId });
        await hybridSessionStore.deleteByUserId(userId);

        // 4. INVALIDATE DATABASE SESSIONS
        const deleteConditions: {
          userId: string;
          ipAddress?: string;
        } = { userId };

        if (input.force) {
          debugLog.api("logout:force-all-sessions", { userId });
        } else {
          deleteConditions.ipAddress = ip;
          debugLog.api("logout:selective-sessions", { ip, userId });
        }

        const deleteResult = await prisma.session.deleteMany({
          where: deleteConditions,
        });

        debugLog.api("logout:db-sessions-deleted", {
          deletedCount: deleteResult.count,
          force: input.force,
          ip,
          userId,
        });

        // 5. INVALIDATE ACCOUNTS (Optional - only for security concerns)
        if (input.reason === "security-concern") {
          debugLog.api("logout:invalidating-accounts", { userId });

          await prisma.account.updateMany({
            data: {
              accessToken: null,
              accessTokenExpiresAt: new Date(),
              refreshToken: null,
              refreshTokenExpiresAt: new Date(),
              updatedAt: new Date(),
            },
            where: { userId },
          });
        }

        // 6. SECURITY AUDIT LOGGING
        await auditLogout({
          ip,
          metadata: {
            clientMetadata: input.clientMetadata,
            duration: Date.now() - startTime,
            force: input.force,
            sessionsDeleted: deleteResult.count,
          },
          reason: input.reason,
          userAgent,
          userId,
        });

        // 7. NOTIFICATION (Optional - could notify user of logout)
        // This could be extended to send push notifications or emails

        const endTime = Date.now();
        const duration = endTime - startTime;

        debugLog.api("logout:completed", {
          duration,
          force: input.force,
          reason: input.reason,
          sessionsDeleted: deleteResult.count,
          userId,
        });

        return {
          accountsInvalidated: input.reason === "security-concern",
          duration,
          message: input.force
            ? "Logged out from all devices"
            : "Logged out successfully",
          redisCleared: true,
          sessionsCleared: deleteResult.count,
          success: true,
        } as const;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        debugLog.api("logout:error", {
          duration: Date.now() - startTime,
          error: errorMessage,
          ip,
          reason: input.reason,
          userId,
        });

        await auditLogout({
          ip,
          metadata: {
            error: errorMessage,
            force: input.force,
            originalReason: input.reason,
          },
          reason: "logout-error",
          userAgent,
          userId,
        }).catch(() => {
          // Ignore audit errors to prevent cascading failures
        });

        return {
          error: "logout-failed",
          message: "An error occurred during logout. Please try again.",
          success: false,
        } as const;
      }
    }),

  validateToken: procedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const { validateJWTToken, cacheJWTValidation } =
          await import("@asm/auth/core");
        const validation = await validateJWTToken(input.token);

        if (!validation.valid) {
          return {
            error: validation.error,
            valid: false,
          } as const;
        }

        if (validation.payload) {
          await cacheJWTValidation(input.token, validation.payload);
        }

        return {
          userId: validation.payload?.sub,
          valid: true,
        } as const;
      } catch (error) {
        console.error("Token validation error:", error);
        return {
          error: "Validation failed",
          valid: false,
        } as const;
      }
    }),
});

function getClientIpFromHeaders(headers: Headers | undefined): string {
  const forwarded = headers?.get?.("x-forwarded-for");
  if (!forwarded) {
    return "unknown";
  }
  const first = forwarded.split(",")[0]?.trim();
  return first || "unknown";
}

import { hybridSessionStore } from "@asm/auth/core";
import { debugLog } from "@asm/config/debug";
import { prisma } from "@asm/db";
import { z } from "zod";
import { procedure, protectedProcedure, router } from "../../trpc";
import { auditLogout, checkLogoutRateLimit } from "../security";

export const authRouter = router({
  generateToken: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    );

    const token = await new SignJWT({
      sub: userId,
      email: ctx.user.email,
      name: ctx.user.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .setIssuer(process.env.APP_URL || "https://social.localhost")
      .setAudience(process.env.APP_URL || "https://social.localhost")
      .sign(secret);

    return { token };
  }),

  validateToken: procedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const { validateJWTToken, cacheJWTValidation } = await import(
          "@asm/auth/core"
        );
        const validation = await validateJWTToken(input.token);

        if (!validation.valid) {
          return {
            valid: false,
            error: validation.error,
          } as const;
        }

        if (validation.payload) {
          await cacheJWTValidation(input.token, validation.payload);
        }

        return {
          valid: true,
          userId: validation.payload?.sub,
        } as const;
      } catch (error) {
        console.error("Token validation error:", error);
        return {
          valid: false,
          error: "Validation failed",
        } as const;
      }
    }),

  logout: protectedProcedure
    .input(
      z.object({
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
        force: z.boolean().optional().default(false),
        clientMetadata: z
          .object({
            deviceId: z.string().optional(),
            userAgent: z.string().optional(),
            location: z.string().optional(),
          })
          .optional(),
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
        userId,
        ip,
        reason: input.reason,
        force: input.force,
      });

      try {
        // 1. RATE LIMITING CHECK
        const rateCheck = await checkLogoutRateLimit(userId, ip);
        if (!rateCheck.ok) {
          await auditLogout({
            userId,
            ip,
            userAgent,
            reason: "rate-limited",
            metadata: {
              retryAfter: rateCheck.retryAfter,
              originalReason: input.reason,
            },
          });

          return {
            success: false,
            error: "rate-limited",
            retryAfter: rateCheck.retryAfter,
          } as const;
        }

        // 2. VALIDATE USER SESSION INTEGRITY
        const currentSession = await prisma.session.findFirst({
          where: {
            userId,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, token: true, expiresAt: true },
        });

        if (!currentSession) {
          await auditLogout({
            userId,
            ip,
            userAgent,
            reason: "no-active-session",
            metadata: {
              originalReason: input.reason,
              force: input.force,
            },
          });

          return {
            success: false,
            error: "no-active-session",
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
          debugLog.api("logout:selective-sessions", { userId, ip });
        }

        const deleteResult = await prisma.session.deleteMany({
          where: deleteConditions,
        });

        debugLog.api("logout:db-sessions-deleted", {
          userId,
          deletedCount: deleteResult.count,
          force: input.force,
          ip,
        });

        // 5. INVALIDATE ACCOUNTS (Optional - only for security concerns)
        if (input.reason === "security-concern") {
          debugLog.api("logout:invalidating-accounts", { userId });

          await prisma.account.updateMany({
            where: { userId },
            data: {
              accessToken: null,
              refreshToken: null,
              accessTokenExpiresAt: new Date(),
              refreshTokenExpiresAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }

        // 6. SECURITY AUDIT LOGGING
        await auditLogout({
          userId,
          ip,
          userAgent,
          reason: input.reason,
          metadata: {
            force: input.force,
            sessionsDeleted: deleteResult.count,
            clientMetadata: input.clientMetadata,
            duration: Date.now() - startTime,
          },
        });

        // 7. NOTIFICATION (Optional - could notify user of logout)
        // This could be extended to send push notifications or emails

        const endTime = Date.now();
        const duration = endTime - startTime;

        debugLog.api("logout:completed", {
          userId,
          duration,
          sessionsDeleted: deleteResult.count,
          reason: input.reason,
          force: input.force,
        });

        return {
          success: true,
          sessionsCleared: deleteResult.count,
          redisCleared: true,
          accountsInvalidated: input.reason === "security-concern",
          duration,
          message: input.force
            ? "Logged out from all devices"
            : "Logged out successfully",
        } as const;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        debugLog.api("logout:error", {
          userId,
          ip,
          error: errorMessage,
          reason: input.reason,
          duration: Date.now() - startTime,
        });

        await auditLogout({
          userId,
          ip,
          userAgent,
          reason: "logout-error",
          metadata: {
            error: errorMessage,
            originalReason: input.reason,
            force: input.force,
          },
        }).catch(() => {
          // Ignore audit errors to prevent cascading failures
        });

        return {
          success: false,
          error: "logout-failed",
          message: "An error occurred during logout. Please try again.",
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

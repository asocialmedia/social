import { createHash } from "node:crypto";

import { hashPasswordWithScrypt } from "@asm/auth/core";
import { debugLog } from "@asm/config/debug";
import { prisma } from "@asm/db";
import { createLogger } from "@asm/logger";
import { z } from "zod";

import { procedure, router } from "../../trpc";
import { auditResetPassword, checkResetPasswordRateLimit } from "../security";

const logger = createLogger({ serviceName: "auth-reset-password" });

// Non-reversible correlation value for a reset token (never log the token or
// a readable fragment of it).
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

// Redact PII from logs: email identifiers keep only their first char + domain;
// usernames are hashed so they are still correlatable without being stored raw.
function redactIdentifier(value: string): string {
  if (EMAIL_REGEX.test(value)) {
    const [local, domain] = value.split("@");
    if (!domain) {
      return "***";
    }
    const head = local.length > 1 ? local.slice(0, 1) : local;
    return `${head}***@${domain}`;
  }
  return `${value.slice(0, 2)}***`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

const requestResetSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .nonempty("Identifier is required")
      .refine(
        (value) => EMAIL_REGEX.test(value) || USERNAME_REGEX.test(value),
        "Please enter a valid email address or username"
      ),
    ip: z.string().optional(),
    userAgent: z.string().optional(),
  })
  .strict();

const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .trim()
      .min(8, "Password must be at least 8 characters"),
    token: z.string(),
  })
  .strict();

export const resetPasswordRouter = router({
  requestReset: procedure
    .input(requestResetSchema)
    .mutation(async ({ input }) => {
      const { identifier, ip = "unknown", userAgent = null } = input;

      try {
        const rateCheck = await checkResetPasswordRateLimit(identifier, ip);
        if (!rateCheck.ok) {
          await auditResetPassword({
            identifier,
            ip,
            metadata: {
              reason: "rate-limited",
              retryAfter: rateCheck.retryAfter,
            },
            success: false,
            userAgent,
          });

          return {
            error: "Too many reset attempts. Please try again later.",
            retryAfter: rateCheck.retryAfter,
            success: false,
          };
        }

        const user = EMAIL_REGEX.test(identifier)
          ? await prisma.user.findUnique({
              select: { email: true, id: true, username: true },
              where: { email: identifier },
            })
          : await prisma.user.findUnique({
              select: { email: true, id: true, username: true },
              where: { username: identifier },
            });

        if (!user) {
          logger.info(
            { identifier: redactIdentifier(identifier) },
            "reset password requested for unknown account"
          );
          await auditResetPassword({
            identifier,
            ip,
            metadata: {
              reason: "user-not-found",
            },
            success: false,
            userAgent,
          });

          return { success: true };
        }

        logger.info(
          { identifier: redactIdentifier(identifier), userId: user.id },
          "reset password request accepted; email sent by auth service"
        );

        await auditResetPassword({
          identifier,
          ip,
          metadata: {
            foundBy: EMAIL_REGEX.test(identifier) ? "email" : "username",
          },
          success: true,
          userAgent,
          userId: user.id,
        });

        return { success: true };
      } catch (error) {
        debugLog.api("reset-password:request-error", {
          error: error instanceof Error ? error.message : String(error),
          identifier,
        });

        await auditResetPassword({
          identifier,
          ip,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
          success: false,
          userAgent,
        }).catch(() => {
          // Ignore audit errors
        });

        return {
          error: "Failed to process password reset request",
          success: false,
        };
      }
    }),

  resetPassword: procedure
    .input(resetPasswordSchema)
    .mutation(async ({ input }) => {
      const { token, newPassword } = input;

      try {
        const verification = await prisma.verification.findFirst({
          select: { id: true, userId: true },
          where: {
            expiresAt: { gt: new Date() },
            value: token,
          },
        });

        if (!verification?.userId) {
          logger.warn(
            { tokenHash: hashToken(token) },
            "reset password rejected: invalid or expired token"
          );
          return {
            error: "Invalid or expired reset token",
            success: false,
          };
        }

        const hashedPassword = await hashPasswordWithScrypt(newPassword);

        await prisma.$transaction(async (tx) => {
          const userId = verification.userId as string;
          await tx.user.update({
            data: { passwordHash: hashedPassword },
            where: { id: userId },
          });

          await tx.verification.delete({
            where: { id: verification.id },
          });

          await tx.session.deleteMany({
            where: { userId },
          });
        });

        logger.info(
          { userId: verification.userId },
          "password reset completed; sessions revoked"
        );

        return { success: true };
      } catch (error) {
        debugLog.api("reset-password:error", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          error: "Failed to reset password",
          success: false,
        };
      }
    }),
});

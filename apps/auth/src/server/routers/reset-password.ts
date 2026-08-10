import { hashPasswordWithScrypt } from "@asm/auth/core";
import { debugLog } from "@asm/config/debug";
import { prisma } from "@asm/db";
import { z } from "zod";
import { procedure, router } from "../trpc";
import { auditResetPassword, checkResetPasswordRateLimit } from "./security";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requestResetSchema = z
  .object({
    identifier: z.string().trim().nonempty("Identifier is required"),
    ip: z.string().optional(),
    userAgent: z.string().optional(),
  })
  .strict();

const resetPasswordSchema = z
  .object({
    token: z.string(),
    newPassword: z
      .string()
      .trim()
      .min(8, "Password must be at least 8 characters"),
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
            userAgent,
            success: false,
            metadata: {
              reason: "rate-limited",
              retryAfter: rateCheck.retryAfter,
            },
          });

          return {
            success: false,
            error: "Too many reset attempts. Please try again later.",
            retryAfter: rateCheck.retryAfter,
          };
        }

        let user: {
          id: string;
          email: string | null;
          username: string;
        } | null = null;

        if (EMAIL_REGEX.test(identifier)) {
          user = await prisma.user.findUnique({
            where: { email: identifier },
            select: { id: true, email: true, username: true },
          });
        } else {
          user = await prisma.user.findUnique({
            where: { username: identifier },
            select: { id: true, email: true, username: true },
          });
        }

        if (!user) {
          await auditResetPassword({
            identifier,
            ip,
            userAgent,
            success: false,
            metadata: {
              reason: "user-not-found",
            },
          });

          return { success: true };
        }

        await auditResetPassword({
          identifier,
          ip,
          userAgent,
          success: true,
          userId: user.id,
          metadata: {
            foundBy: EMAIL_REGEX.test(identifier) ? "email" : "username",
          },
        });

        return { success: true };
      } catch (error) {
        debugLog.api("reset-password:request-error", {
          identifier,
          error: error instanceof Error ? error.message : String(error),
        });

        await auditResetPassword({
          identifier,
          ip,
          userAgent,
          success: false,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        }).catch(() => {
          // Ignore audit errors
        });

        return {
          success: false,
          error: "Failed to process password reset request",
        };
      }
    }),

  resetPassword: procedure
    .input(resetPasswordSchema)
    .mutation(async ({ input }) => {
      const { token, newPassword } = input;

      try {
        const verification = await prisma.verification.findFirst({
          where: {
            value: token,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, userId: true },
        });

        if (!verification?.userId) {
          return {
            success: false,
            error: "Invalid or expired reset token",
          };
        }

        const hashedPassword = await hashPasswordWithScrypt(newPassword);

        await prisma.$transaction(async (tx) => {
          const userId = verification.userId as string;
          await tx.user.update({
            where: { id: userId },
            data: { passwordHash: hashedPassword },
          });

          await tx.verification.delete({
            where: { id: verification.id },
          });

          await tx.session.deleteMany({
            where: { userId },
          });
        });

        return { success: true };
      } catch (error) {
        debugLog.api("reset-password:error", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: "Failed to reset password",
        };
      }
    }),
});

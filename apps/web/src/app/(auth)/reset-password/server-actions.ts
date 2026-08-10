"use server";

import { EMAIL_REGEX, USERNAME_REGEX } from "@asm/auth/validation";
import { debugLog } from "@asm/config/debug";
import { prisma } from "@asm/db";
import { headers } from "next/headers";
import { z } from "zod";
import { authClient } from "@/lib/auth";

async function makePasswordResetRequest(
  identifier: string,
  ip: string,
  userAgent: string | null
): Promise<{ success: boolean; error?: string; retryAfter?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_AUTH_URL}/api/trpc/resetPassword.requestReset`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userAgent && { "user-agent": userAgent }),
        },
        body: JSON.stringify({
          json: { identifier, ip, userAgent },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Network error" }));
      return {
        success: false,
        error:
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const result = await response.json();

    if (!result.result?.data?.json?.success) {
      const error = result.result?.data?.json?.error || "Rate limit exceeded";
      const retryAfter = result.result?.data?.json?.retryAfter;
      return { success: false, error, retryAfter };
    }

    return { success: true };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, error: "Request timeout. Please try again." };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error occurred",
    };
  }
}

const requestResetSchema = z.object({
  identifier: z
    .string()
    .min(1, "Please enter your username or email address")
    .refine((value) => {
      if (EMAIL_REGEX.test(value)) {
        return true;
      }
      return USERNAME_REGEX.test(value);
    }, "Please enter a valid email address or username"),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
      "Password must include: uppercase & lowercase letters, number, and special character"
    ),
});

async function getClientInfo() {
  const headersList = await headers();
  const ip =
    headersList.get("x-forwarded-for") ||
    headersList.get("x-real-ip") ||
    "unknown";
  const userAgent = headersList.get("user-agent") || null;

  return { ip: ip.split(",")[0]?.trim() || "unknown", userAgent };
}

export async function requestPasswordReset(
  data: z.infer<typeof requestResetSchema>
): Promise<{ success: boolean; error?: string; retryAfter?: number }> {
  try {
    const { identifier } = requestResetSchema.parse(data);
    const { ip, userAgent } = await getClientInfo();

    const requestResult = await makePasswordResetRequest(
      identifier,
      ip,
      userAgent
    );
    if (!requestResult.success) {
      return requestResult;
    }

    let user: { id: string; email: string | null; username: string } | null =
      null;
    let email: string | null = null;

    if (EMAIL_REGEX.test(identifier)) {
      user = await prisma.user.findUnique({
        where: { email: identifier },
        select: { id: true, email: true, username: true },
      });
      email = identifier;
    } else {
      user = await prisma.user.findUnique({
        where: { username: identifier },
        select: { id: true, email: true, username: true },
      });
      email = user?.email || null;
    }

    if (!(user && email)) {
      return { success: true };
    }

    // @ts-expect-error: TODO: Fix types
    await authClient.forgetPassword({
      email,
      fetchOptions: {
        onSuccess: () => {
          // Password reset email sent successfully
        },
        onError: (error: unknown) => {
          debugLog.api("Password reset request error", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Error("Failed to process password reset request");
        },
      },
    });

    return { success: true };
  } catch (error) {
    debugLog.api("Password reset request error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: "Failed to process password reset request",
    };
  }
}

export async function resetPassword(data: z.infer<typeof resetPasswordSchema>) {
  try {
    const { token, password } = resetPasswordSchema.parse(data);

    await authClient.resetPassword({
      token,
      newPassword: password,
      fetchOptions: {
        onSuccess: () => {
          // Password reset successfully
        },
        onError: (error) => {
          debugLog.api("Password reset error", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Error("Failed to reset password");
        },
      },
    });

    return { success: true };
  } catch (error) {
    debugLog.api("Password reset error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "Failed to reset password" };
  }
}

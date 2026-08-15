"use server";

import { EMAIL_REGEX, USERNAME_REGEX } from "@asm/auth/validation";
import { debugLog } from "@asm/config/debug";
import { prisma } from "@asm/db";
import { headers } from "next/headers";
import { z } from "zod";

import { authInternalHeaders } from "@/lib/auth-internal";

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
        body: JSON.stringify({
          json: { identifier, ip, userAgent },
        }),
        headers: authInternalHeaders({
          "Content-Type": "application/json",
          ...(userAgent && { "user-agent": userAgent }),
        }),
        method: "POST",
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Network error" }));
      return {
        error:
          errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        success: false,
      };
    }

    const result = await response.json();

    if (!result.result?.data?.json?.success) {
      const error = result.result?.data?.json?.error || "Rate limit exceeded";
      const retryAfter = result.result?.data?.json?.retryAfter;
      return { error, retryAfter, success: false };
    }

    return { success: true };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "Request timeout. Please try again.", success: false };
    }
    return {
      error: error instanceof Error ? error.message : "Network error occurred",
      success: false,
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
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
      "Password must include: uppercase & lowercase letters, number, and special character"
    ),
  token: z.string(),
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
        select: { email: true, id: true, username: true },
        where: { email: identifier },
      });
      email = identifier;
    } else {
      user = await prisma.user.findUnique({
        select: { email: true, id: true, username: true },
        where: { username: identifier },
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
        onError: (error: unknown) => {
          debugLog.api("Password reset request error", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Error("Failed to process password reset request");
        },
        onSuccess: () => {
          // Password reset email sent successfully
        },
      },
    });

    // The auth service is the only party that can hand out a password reset
    // token and mail the reset link. Send the request to the better-auth
    // endpoint directly (authClient.forgetPassword targets a deprecated path
    // that 404s), with the shared internal secret for the server-to-server hop.
    const authBase = process.env.NEXT_PUBLIC_AUTH_URL;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(
        `${authBase}/api/auth/request-password-reset`,
        {
          body: JSON.stringify({ email }),
          headers: authInternalHeaders({ "Content-Type": "application/json" }),
          method: "POST",
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        debugLog.api("Password reset request error", {
          status: response.status,
        });
        throw new Error("Failed to process password reset request");
      }
    } finally {
      clearTimeout(timeoutId);
    }

    return { success: true };
  } catch (error) {
    debugLog.api("Password reset request error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: "Failed to process password reset request",
      success: false,
    };
  }
}

export async function resetPassword(
  data: z.infer<typeof resetPasswordSchema>
): Promise<{ success?: boolean; error?: string }> {
  try {
    const { token, password } = resetPasswordSchema.parse(data);

    const authBase = process.env.NEXT_PUBLIC_AUTH_URL;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(`${authBase}/api/auth/reset-password`, {
        body: JSON.stringify({ newPassword: password, token }),
        headers: authInternalHeaders({ "Content-Type": "application/json" }),
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        debugLog.api("Password reset error", { status: response.status });
        throw new Error("Failed to reset password");
      }
    } finally {
      clearTimeout(timeoutId);
    }

    return { success: true };
  } catch (error) {
    debugLog.api("Password reset error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "Failed to reset password" };
  }
}

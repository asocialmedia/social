"use client";

import type { LoginValues } from "@asm/auth/validation";

import { authClient } from "@/lib/auth";

const EMAIL_REGEX = /@/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return undefined;
}

function banResult(error: unknown) {
  const message = errorMessage(error);
  if (!message) {
    return null;
  }
  try {
    const parsed = JSON.parse(message) as unknown;
    if (!isRecord(parsed) || parsed.code !== "USER_BANNED") {
      return null;
    }
    const banExpires =
      typeof parsed.banExpires === "string" ? parsed.banExpires : undefined;
    const banReason =
      typeof parsed.banReason === "string"
        ? parsed.banReason
        : "Policy violation";
    return {
      banExpires,
      banReason,
      banned: true,
      error: `Account suspended: ${banReason}. Ban expires: ${banExpires ? new Date(banExpires).toLocaleDateString() : "indefinitely"}`,
      success: false,
    } as const;
  } catch {
    return null;
  }
}

export async function login(values: LoginValues) {
  const isEmail = EMAIL_REGEX.test(values.username);
  try {
    // Better Auth resolves ordinary HTTP failures as { error }, rather than
    // rejecting. Let the form own one navigation after a confirmed response.
    const result = await (isEmail
      ? authClient.signIn.email({
          email: values.username,
          password: values.password,
        })
      : authClient.signIn.username({
          password: values.password,
          username: values.username,
        }));
    if (result.error) {
      return (
        banResult(result.error) ?? {
          error: "Invalid username/email or password",
          success: false,
        }
      );
    }
    return { success: true } as const;
  } catch (error) {
    return (
      banResult(error) ?? {
        error: "Unable to sign in right now. Please try again.",
        success: false,
      }
    );
  }
}

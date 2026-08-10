"use client";

import type { LoginValues } from "@asm/auth/validation";
import { authClient } from "@/lib/auth";

const EMAIL_REGEX = /@/;

export async function login(values: LoginValues) {
  const isEmail = EMAIL_REGEX.test(values.username);
  try {
    if (isEmail) {
      await authClient.signIn.email({
        email: values.username,
        password: values.password,
        callbackURL: "/",
        fetchOptions: {
          onError: () => {
            throw new Error("signin-failed");
          },
        },
      });
    } else {
      await authClient.signIn.email({
        email: values.username,
        password: values.password,
        callbackURL: "/",
        fetchOptions: {
          onError: () => {
            throw new Error("signin-failed");
          },
        },
      });
    }
    return { success: true } as const;
  } catch (error) {
    if (error instanceof Error) {
      try {
        const parsedError = JSON.parse(error.message);
        if (parsedError.code === "USER_BANNED") {
          const banExpires = parsedError.banExpires
            ? new Date(parsedError.banExpires).toLocaleDateString()
            : "indefinitely";
          return {
            success: false,
            error: `Account suspended: ${parsedError.banReason}. Ban expires: ${banExpires}`,
            banned: true,
            banReason: parsedError.banReason,
            banExpires: parsedError.banExpires,
          } as const;
        }
      } catch {
        // Not a JSON error, fall through to generic error
      }
    }

    return {
      success: false,
      error: "Invalid username/email or password",
    } as const;
  }
}

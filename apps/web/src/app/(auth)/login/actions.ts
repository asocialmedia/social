"use client";

import type { LoginValues } from "@asm/auth/validation";

import { authClient } from "@/lib/auth";

const EMAIL_REGEX = /@/;

export async function login(values: LoginValues) {
  const isEmail = EMAIL_REGEX.test(values.username);
  try {
    await (isEmail
      ? authClient.signIn.email({
          callbackURL: "/",
          email: values.username,
          fetchOptions: {
            onError: () => {
              throw new Error("signin-failed");
            },
          },
          password: values.password,
        })
      : authClient.signIn.username({
          callbackURL: "/",
          fetchOptions: {
            onError: () => {
              throw new Error("signin-failed");
            },
          },
          password: values.password,
          username: values.username,
        }));
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
            banExpires: parsedError.banExpires,
            banReason: parsedError.banReason,
            banned: true,
            error: `Account suspended: ${parsedError.banReason}. Ban expires: ${banExpires}`,
            success: false,
          } as const;
        }
      } catch {
        // Not a JSON error, fall through to generic error
      }
    }

    return {
      error: "Invalid username/email or password",
      success: false,
    } as const;
  }
}

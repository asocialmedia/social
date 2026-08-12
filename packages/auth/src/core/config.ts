import { prisma } from "@asm/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
  admin as adminPlugin,
  emailOTP,
  jwt,
  username,
} from "better-auth/plugins";
import type {
  GoogleProfile,
  RedditProfile,
} from "better-auth/social-providers";
import { env } from "../../env";

const DEFAULT_AVATARS = ["/avatars/default-1.png", "/avatars/default-2.png"];

export function pickRandomDefaultAvatar(): string {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)];
}

export function extractTokenFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("token") ||
      parsed.pathname.split("/").filter(Boolean).pop() ||
      ""
    );
  } catch {
    const withoutQuery = url.split("?")[0] || "";
    return withoutQuery.split("/").pop() || "";
  }
}

import { hashPasswordWithScrypt, verifyPasswordHash } from "./password";

function deriveUsernameFromProfile(
  profile:
    | {
        email?: string;
        username?: string;
        login?: string;
        screen_name?: string;
      }
    | unknown
): string {
  const obj =
    profile && typeof profile === "object"
      ? (profile as Record<string, unknown>)
      : {};
  const email = typeof obj.email === "string" ? obj.email : undefined;
  const candidate =
    (typeof obj.username === "string" && obj.username) ||
    (typeof obj.login === "string" && obj.login) ||
    (typeof (obj as { screen_name?: string }).screen_name === "string" &&
      (obj as { screen_name?: string }).screen_name) ||
    (email ? email.split("@")[0] : "");
  const sanitized = String(candidate)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || (email ? email.split("@")[0] : "user");
}

export interface EmailService {
  sendPasswordResetEmail?: (
    email: string,
    token: string
  ) => Promise<{ success: boolean; error?: string; resetUrl?: string }>;
  sendVerificationEmail?: (
    email: string,
    token: string
  ) => Promise<{ success: boolean; error?: string; verificationUrl?: string }>;
}

export interface AuthConfig {
  baseURL?: string;
  emailService?: EmailService;
  environment?: "development" | "production";
  /**
   * Function to send verification OTP. Returns void to match better-auth's expectations.
   * The underlying email service returns EmailResult, but this function handles
   * the conversion and error propagation internally.
   */
  sendVerificationOTP?: (params: {
    email: string;
    otp: string;
    type: string;
  }) => Promise<void>;
}

type SocialProviderName = "google" | "reddit";

interface UsernameMapping {
  username: string;
}

export interface SocialProvidersConfig {
  google?: {
    clientId: string;
    clientSecret: string;
    redirectURI: string;
    mapProfileToUser: (profile: GoogleProfile) => UsernameMapping;
  };
  reddit?: {
    clientId: string;
    clientSecret: string;
    redirectURI: string;
    mapProfileToUser: (profile: RedditProfile) => UsernameMapping;
  };
}

function buildSocialProviderConfig(authBaseUrl: string): {
  socialProviders: SocialProvidersConfig;
  trustedProviders: SocialProviderName[];
} {
  const socialProviders: SocialProvidersConfig = {};
  const trustedProviders: SocialProviderName[] = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectURI: `${authBaseUrl}/api/auth/callback/google`,
      mapProfileToUser(profile: GoogleProfile): UsernameMapping {
        const derivedUsername = deriveUsernameFromProfile(profile);
        return { username: derivedUsername };
      },
    };
    trustedProviders.push("google");
  }

  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    socialProviders.reddit = {
      clientId: env.REDDIT_CLIENT_ID,
      clientSecret: env.REDDIT_CLIENT_SECRET,
      redirectURI: `${authBaseUrl}/api/auth/callback/reddit`,
      mapProfileToUser(profile: RedditProfile): UsernameMapping {
        const derivedUsername = deriveUsernameFromProfile(profile);
        return { username: derivedUsername };
      },
    };
    trustedProviders.push("reddit");
  }

  return { socialProviders, trustedProviders };
}

export function createAuthConfig(config: AuthConfig = {}) {
  const {
    baseURL,
    emailService,
    environment = env.NODE_ENV || "development",
    sendVerificationOTP,
  } = config;

  const authBaseUrl = baseURL || process.env.BETTER_AUTH_URL || env.AUTH_URL;
  const { socialProviders, trustedProviders } =
    buildSocialProviderConfig(authBaseUrl);

  return betterAuth({
    baseURL: authBaseUrl,
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),

    user: {
      fields: {
        name: "displayName",
      },
      additionalFields: {
        username: {
          type: "string",
          required: true,
        },
        displayUsername: {
          type: "string",
          required: false,
        },
        role: {
          type: "string",
          required: true,
          defaultValue: "user",
        },
      },
    },

    plugins: [
      username(),
      jwt(),
      adminPlugin(),
      ...(sendVerificationOTP
        ? [
            emailOTP({
              overrideDefaultEmailVerification: true,
              otpLength: 6,
              expiresIn: 300,
              allowedAttempts: 3,
              sendVerificationOTP,
            }),
          ]
        : []),
    ],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      password: {
        hash: async (password: string) => hashPasswordWithScrypt(password),
        verify: async ({
          hash,
          password,
        }: {
          hash: string;
          password: string;
        }) => verifyPasswordHash(password, hash),
      },
      sendResetPassword: emailService?.sendPasswordResetEmail
        ? async ({ user, url }) => {
            const token = extractTokenFromUrl(url);
            await emailService.sendPasswordResetEmail?.(user.email, token);
          }
        : ({ user, url }) => {
            if (environment === "development") {
              console.log(`Reset password email for ${user.email}: ${url}`);
            } else {
              throw new Error("Password reset email service not configured");
            }
            return Promise.resolve();
          },
    },

    ...(trustedProviders.length > 0 ? { socialProviders } : {}),

    account: {
      accountLinking: {
        enabled: trustedProviders.length > 0,
        trustedProviders,
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: false,
      },
      // freshAge can protect sensitive actions; keep default or tune as needed
    },

    advanced: {
      useSecureCookies: environment === "production",
      ...(environment === "production"
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: ".asocialmedia.cc",
            },
          }
        : {}),
      database: {
        generateId: crypto.randomUUID,
      },
      // cookiePrefix can be set if multiple auth stacks coexist
    },

    verification: {
      modelName: "verification",
    },

    trustedOrigins: [
      env.APP_URL,
      env.AUTH_URL,
      "https://social.localhost",
      "https://auth.localhost",
      "http://localhost:3000",
      "http://localhost:3001",
      "https://asocialmedia.cc",
    ],

    telemetry: {
      enabled: false,
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              const authBase = env.APP_URL ?? "https://social.localhost";
              const avatarUrl = `${authBase}${pickRandomDefaultAvatar()}`;
              await prisma.user.update({
                where: { id: user.id },
                data: { avatarUrl },
              });
            } catch (error) {
              console.error(
                "Failed to assign random default avatar:",
                error instanceof Error ? error.message : error
              );
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { banned: true, banReason: true, banExpires: true },
            });

            if (user?.banned) {
              const now = new Date();
              const isExpired = user.banExpires && user.banExpires <= now;

              if (isExpired) {
                await prisma.user.update({
                  where: { id: session.userId },
                  data: { banned: false, banReason: null, banExpires: null },
                });
              } else {
                throw new Error(
                  JSON.stringify({
                    code: "USER_BANNED",
                    banReason: user.banReason || "Account suspended",
                    banExpires: user.banExpires?.toISOString(),
                  })
                );
              }
            }
          },
        },
      },
    },

    ...(!sendVerificationOTP &&
      emailService?.sendVerificationEmail && {
        emailVerification: {
          sendVerificationEmail: async ({ user, url }) => {
            const token = extractTokenFromUrl(url);
            await emailService.sendVerificationEmail?.(user.email, token);
          },
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
        },
      }),
  });
}

export const auth = createAuthConfig();

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
import { hashPasswordWithScrypt, verifyPasswordHash } from "./password";

const DEFAULT_AVATARS = ["/avatars/default-1.png", "/avatars/default-2.png"];

export function pickRandomDefaultAvatar(): string {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)];
}

export function extractTokenFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname
      .split("/")
      .toReversed()
      .find((segment) => segment.length > 0);
    return parsed.searchParams.get("token") || lastSegment || "";
  } catch {
    const withoutQuery = url.split("?")[0] || "";
    return withoutQuery.split("/").pop() || "";
  }
}

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
    .replaceAll(/[^a-z0-9_]/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
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

// Fields better-auth accepts from mapProfileToUser when creating/linking a
// user via a social provider. username is required; the rest shape the new
// account (Reddit exposes no email, so the derived name is what we can set).
interface SocialUserMapping {
  emailVerified?: boolean;
  name?: string;
  username: string;
}

export interface SocialProvidersConfig {
  google?: {
    clientId: string;
    clientSecret: string;
    redirectURI: string;
    mapProfileToUser: (profile: GoogleProfile) => SocialUserMapping;
  };
  reddit?: {
    clientId: string;
    clientSecret: string;
    redirectURI: string;
    mapProfileToUser: (profile: RedditProfile) => SocialUserMapping;
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
      mapProfileToUser(profile: GoogleProfile): SocialUserMapping {
        const derivedUsername = deriveUsernameFromProfile(profile);
        const email =
          typeof profile.email === "string" ? profile.email : undefined;
        return {
          emailVerified: Boolean(email),
          name: derivedUsername,
          username: derivedUsername,
        };
      },
      redirectURI: `${authBaseUrl}/api/auth/callback/google`,
    };
    trustedProviders.push("google");
  }

  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    socialProviders.reddit = {
      clientId: env.REDDIT_CLIENT_ID,
      clientSecret: env.REDDIT_CLIENT_SECRET,
      mapProfileToUser(profile: RedditProfile): SocialUserMapping {
        const derivedUsername = deriveUsernameFromProfile(profile);
        return {
          // Reddit's OAuth does not expose the user's email; better-auth
          // synthesizes a placeholder. The OAuth handshake already proves
          // identity, so mark it verified rather than forcing a re-verify of a
          // fake address.
          emailVerified: true,
          name: derivedUsername,
          username: derivedUsername,
        };
      },
      redirectURI: `${authBaseUrl}/api/auth/callback/reddit`,
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

  // eslint-disable-next-line sort-keys
  return betterAuth({
    baseURL: authBaseUrl,
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),

    user: {
      additionalFields: {
        avatarKey: {
          required: false,
          type: "string",
        },
        avatarUrl: {
          required: false,
          type: "string",
        },
        displayUsername: {
          required: false,
          type: "string",
        },
        role: {
          defaultValue: "user",
          required: true,
          type: "string",
        },
        username: {
          required: true,
          type: "string",
        },
      },
      fields: {
        name: "displayName",
      },
    },

    plugins: [
      username(),
      jwt(),
      adminPlugin(),
      ...(sendVerificationOTP
        ? [
            emailOTP({
              allowedAttempts: 3,
              expiresIn: 300,
              otpLength: 6,
              overrideDefaultEmailVerification: true,
              sendVerificationOTP,
            }),
          ]
        : []),
    ],

    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password: string) => hashPasswordWithScrypt(password),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          verifyPasswordHash(password, hash),
      },
      requireEmailVerification: true,
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
      cookieCache: {
        enabled: false,
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // freshAge can protect sensitive actions; keep default or tune as needed
    },

    advanced: {
      useSecureCookies: environment === "production",
      ...(environment === "production"
        ? {
            crossSubDomainCookies: {
              domain: ".asocialmedia.cc",
              enabled: true,
            },
          }
        : {}),
      database: {
        generateId: () => crypto.randomUUID(),
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
      account: {
        create: {
          after: async (account) => {
            // better-auth stores the OAuth linkage in the Account table, but
            // the app reads googleId/redditId directly off the user. Mirror the
            // provider linkage onto the user so the linked-accounts UI and any
            // downstream lookups reflect the connection immediately.
            try {
              const providerToField: Record<string, string | undefined> = {
                google: "googleId",
                reddit: "redditId",
              };
              const field = providerToField[account.providerId];
              if (field) {
                await prisma.user.update({
                  data: { [field]: account.accountId },
                  where: { id: account.userId },
                });
              }
            } catch (error) {
              console.error(
                "Failed to mirror social provider id onto user:",
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
              select: { banExpires: true, banReason: true, banned: true },
              where: { id: session.userId },
            });

            if (user?.banned) {
              const now = new Date();
              const isExpired = user.banExpires && user.banExpires <= now;

              if (isExpired) {
                await prisma.user.update({
                  data: { banExpires: null, banReason: null, banned: false },
                  where: { id: session.userId },
                });
              } else {
                throw new Error(
                  JSON.stringify({
                    banExpires: user.banExpires?.toISOString(),
                    banReason: user.banReason || "Account suspended",
                    code: "USER_BANNED",
                  })
                );
              }
            }
          },
        },
      },
      user: {
        create: {
          // oxlint-disable-next-line unicorn/require-await
          before: async (user) => {
            // Assign a random default avatar at creation time (not in `after`,
            // which would miss the session returned to the client on signup).
            const authBase = env.APP_URL ?? "https://social.localhost";
            const avatarUrl = `${authBase}${pickRandomDefaultAvatar()}`;
            return { data: { ...user, avatarUrl } };
          },
        },
      },
    },

    ...(!sendVerificationOTP &&
      emailService?.sendVerificationEmail && {
        emailVerification: {
          autoSignInAfterVerification: true,
          sendOnSignUp: true,
          sendVerificationEmail: async ({ user, url }) => {
            const token = extractTokenFromUrl(url);
            await emailService.sendVerificationEmail?.(user.email, token);
          },
        },
      }),
  });
}

export const auth = createAuthConfig();

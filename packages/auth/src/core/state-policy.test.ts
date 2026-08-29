import { describe, expect, mock, test } from "bun:test";

// The prisma adapter reaches the database at import time through @asm/db, so
// mock it before the module under test loads. Reddit credentials are unset in
// the test environment, so only the google provider gets configured.
mock.module("@asm/db", () => ({
  isReservedUsername: () => false,
  prisma: {},
}));
mock.module("better-auth/adapters/prisma", () => ({
  prismaAdapter: () => ({}),
}));
mock.module("better-auth/api", () => ({
  APIError: class APIError extends Error {
    override name = "APIError";
  },
  createAuthMiddleware: (fn: unknown) => fn,
}));

// Capture the config better-auth receives so environment-dependent branches
// can be asserted without spinning up a real auth instance.
const capturedConfigs: Record<string, unknown>[] = [];
mock.module("better-auth", () => ({
  betterAuth: (config: Record<string, unknown>) => {
    capturedConfigs.push(config);
    return { api: {}, handler: () => {} };
  },
}));
mock.module("better-auth/plugins", () => ({
  admin: () => ({}),
  emailOTP: () => ({}),
  jwt: () => ({}),
  username: () => ({}),
}));

// Capture level routing so better-auth diagnostics can be asserted without
// depending on pino's transport internals.
const logCalls: { entry: unknown; level: string; message: string }[] = [];
mock.module("@asm/logger", () => ({
  createLogger: () => ({
    debug: (entry: unknown, message: string) => {
      logCalls.push({ entry, level: "debug", message });
    },
    error: (entry: unknown, message: string) => {
      logCalls.push({ entry, level: "error", message });
    },
    info: (entry: unknown, message: string) => {
      logCalls.push({ entry, level: "info", message });
    },
    warn: (entry: unknown, message: string) => {
      logCalls.push({ entry, level: "warn", message });
    },
  }),
}));

const { createAuthConfig } = await import("./config");

function lastCaptured(): Record<string, unknown> {
  const config = capturedConfigs.at(-1);
  if (!config) {
    throw new Error("betterAuth was never called");
  }
  return config;
}

describe("createAuthConfig oauth state cookie policy", () => {
  test("skips the state cookie check in development (split dev hosts)", () => {
    createAuthConfig({ environment: "development" });

    const account = lastCaptured().account as {
      skipStateCookieCheck?: boolean;
    };
    // Dev origins differ from the callback host, so the state cookie set
    // during sign-in is not always replayed on the callback; the database
    // verification row remains the CSRF guarantee in development.
    expect(account.skipStateCookieCheck).toBe(true);
  });

  test("enforces the state cookie check in production", () => {
    createAuthConfig({ environment: "production" });

    const config = lastCaptured();
    const account = config.account as { skipStateCookieCheck?: boolean };
    const advanced = config.advanced as {
      crossSubDomainCookies?: { domain?: string; enabled?: boolean };
      useSecureCookies?: boolean;
    };

    expect(account.skipStateCookieCheck).toBe(false);
    expect(advanced.crossSubDomainCookies).toEqual({
      domain: ".asocialmedia.cc",
      enabled: true,
    });
    expect(advanced.useSecureCookies).toBe(true);
  });

  test("routes better-auth diagnostics through the structured logger", () => {
    logCalls.length = 0;
    createAuthConfig({ environment: "development" });

    const logger = lastCaptured().logger as {
      log: (level: string, message: string, ...args: unknown[]) => void;
    };
    expect(typeof logger?.log).toBe("function");

    logger.log("error", "Failed to parse state", { state: "abc" });
    logger.log("warn", "degraded provider", { provider: "google" });
    logger.log("info", "flow started");

    expect(logCalls).toEqual([
      {
        entry: { details: [{ state: "abc" }], source: "better-auth" },
        level: "error",
        message: "Failed to parse state",
      },
      {
        entry: { details: [{ provider: "google" }], source: "better-auth" },
        level: "warn",
        message: "degraded provider",
      },
      {
        entry: { details: [], source: "better-auth" },
        level: "info",
        message: "flow started",
      },
    ]);
  });

  test("derives the google callback from the resolved auth base url", () => {
    createAuthConfig({ baseURL: "http://localhost:3001" });

    const socialProviders = lastCaptured().socialProviders as
      | { google?: { redirectURI?: string } }
      | undefined;

    expect(socialProviders?.google?.redirectURI).toBe(
      "http://localhost:3001/api/auth/callback/google"
    );
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CachedSession } from "@asm/db";
import { SignJWT } from "jose";

const originalConsoleError = console.error;

const jwtSessionCacheMock = {
  createTokenHash: mock((token: string) => `hash_${token}`),
  setValidatedSession: mock(
    async (_tokenHash: string, _sessionData: CachedSession): Promise<void> =>
      Promise.resolve()
  ),
  getValidatedSession: mock(
    async (_tokenHash: string): Promise<CachedSession | null> => null
  ),
  invalidateSession: mock(
    async (_tokenHash: string): Promise<void> => Promise.resolve()
  ),
};

const originalEnv = {
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXT_PUBLIC_URL: process.env.NEXT_PUBLIC_URL,
};

mock.module("@asm/db", () => ({
  jwtSessionCache: jwtSessionCacheMock,
  prisma: {},
  redis: {},
}));

import {
  cacheJWTValidation,
  createJWTValidationCacheKey,
  extractTokenFromHeader,
  getCachedJWTValidation,
  invalidateCachedJWT,
  validateJWTToken,
} from "./jwt";

describe("jwt helpers", () => {
  let secret: Uint8Array;
  let issuer: string;

  beforeEach(() => {
    console.error = mock(() => undefined) as typeof console.error;
    process.env.NEXTAUTH_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_URL = "https://social.localhost";

    secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);
    issuer = process.env.NEXT_PUBLIC_URL;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    if (originalEnv.NEXTAUTH_SECRET === undefined) {
      delete process.env.NEXTAUTH_SECRET;
    } else {
      process.env.NEXTAUTH_SECRET = originalEnv.NEXTAUTH_SECRET;
    }

    if (originalEnv.NEXT_PUBLIC_URL === undefined) {
      delete process.env.NEXT_PUBLIC_URL;
    } else {
      process.env.NEXT_PUBLIC_URL = originalEnv.NEXT_PUBLIC_URL;
    }

    jwtSessionCacheMock.createTokenHash.mockClear();
    jwtSessionCacheMock.setValidatedSession.mockClear();
    jwtSessionCacheMock.getValidatedSession.mockClear();
    jwtSessionCacheMock.invalidateSession.mockClear();
  });

  describe("validateJWTToken", () => {
    test("returns valid true for good token", async () => {
      const token = await new SignJWT({ "urn:example:claim": true })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(issuer)
        .setExpirationTime("2h")
        .sign(secret);

      const result = await validateJWTToken(token);
      expect(result.valid).toBe(true);
      expect(result.payload?.["urn:example:claim"]).toBe(true);
    });

    test("returns valid false for bad token", async () => {
      const result = await validateJWTToken("invalid.token.str");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("extractTokenFromHeader", () => {
    test("extracts token when Bearer is present", () => {
      expect(extractTokenFromHeader("Bearer mytoken123")).toBe("mytoken123");
    });
    test("returns null when no Bearer", () => {
      expect(extractTokenFromHeader("mytoken123")).toBeNull();
      expect(extractTokenFromHeader(null)).toBeNull();
    });
  });

  describe("cache methods", () => {
    test("createJWTValidationCacheKey", () => {
      expect(createJWTValidationCacheKey("test")).toBe("hash_test");
    });

    test("cacheJWTValidation throws if no sub", async () => {
      await expect(cacheJWTValidation("test", {})).rejects.toThrow(
        "JWT payload missing sub claim"
      );
    });

    test("cacheJWTValidation stores session data", async () => {
      const expectedSessionData = {
        session: {
          id: expect.any(String),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          userId: "user123",
          expiresAt: new Date(12_345 * 1000),
          token: "test",
          ipAddress: undefined,
          userAgent: undefined,
        },
        user: {
          id: "user123",
          email: "test@test.com",
          emailVerified: true,
          name: "",
          username: "",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      };

      await cacheJWTValidation("test", {
        sub: "user123",
        email: "test@test.com",
        email_verified: true,
        exp: 12_345,
      });

      expect(jwtSessionCacheMock.setValidatedSession).toHaveBeenCalledWith(
        "hash_test",
        expectedSessionData
      );
    });

    test("getCachedJWTValidation calls getValidatedSession", async () => {
      await getCachedJWTValidation("test");

      expect(jwtSessionCacheMock.getValidatedSession).toHaveBeenCalledWith(
        "hash_test"
      );
    });

    test("invalidateCachedJWT calls invalidateSession", async () => {
      await invalidateCachedJWT("test");

      expect(jwtSessionCacheMock.invalidateSession).toHaveBeenCalledWith(
        "hash_test"
      );
    });
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { HybridSession, JWTValidationResult } from "@asm/auth/core";

type MiddlewareModule = typeof import("./middleware");

interface SessionLookupUser {
  createdAt: Date;
  displayName: string;
  email: string;
  emailVerified: boolean;
  name: string;
  updatedAt: Date;
  username: string;
}

type ApiSessionResult = {
  session: { id: string; userId: string };
  user: { id: string };
} | null;

const mockFindUnique = mock(
  async (): Promise<SessionLookupUser | { username: string } | null> => null
);

const mockFindByToken = mock(async (): Promise<HybridSession | null> => null);
const mockCreate = mock(async (): Promise<HybridSession | null> => null);
const mockValidateJWTToken = mock(
  async (): Promise<JWTValidationResult> => ({ valid: false })
);

const mockGetSession = mock(async (): Promise<ApiSessionResult> => null);

const originalEnv = {
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
  POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
};

const originalConsole = {
  error: console.error,
  log: console.log,
  warn: console.warn,
};

describe("middleware", () => {
  let middlewareModule: MiddlewareModule;

  const restoreEnvValue = (
    key:
      | "BETTER_AUTH_SECRET"
      | "DATABASE_URL"
      | "POSTGRES_PRISMA_URL"
      | "POSTGRES_URL_NON_POOLING"
  ): void => {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  };

  const validUserData: SessionLookupUser = {
    username: "test",
    email: "test@example.com",
    emailVerified: true,
    name: "Test",
    displayName: "Test User",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    console.error = mock(() => undefined) as typeof console.error;
    console.log = mock(() => undefined) as typeof console.log;
    console.warn = mock(() => undefined) as typeof console.warn;

    mock.module("@asm/db", () => ({
      prisma: {
        user: {
          findUnique: mockFindUnique,
        },
      },
    }));

    mock.module("@asm/auth/core", () => ({
      extractTokenFromHeader: (h: string | null) =>
        h ? h.replace("Bearer ", "") : null,
      hybridSessionStore: {
        findByToken: mockFindByToken,
        create: mockCreate,
      },
      validateJWTToken: mockValidateJWTToken,
    }));

    mock.module("./config", () => ({
      auth: {
        api: {
          getSession: mockGetSession,
        },
      },
    }));

    process.env.DATABASE_URL = "postgresql://mock";
    process.env.POSTGRES_PRISMA_URL = "postgresql://mock";
    process.env.POSTGRES_URL_NON_POOLING = "postgresql://mock";
    process.env.BETTER_AUTH_SECRET =
      "mock-secret-123456789012345678901234567890";

    mockFindUnique.mockClear();
    mockFindByToken.mockClear();
    mockCreate.mockClear();
    mockValidateJWTToken.mockClear();
    mockGetSession.mockClear();

    middlewareModule = await import("./middleware");
  });

  afterEach(() => {
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;

    restoreEnvValue("DATABASE_URL");
    restoreEnvValue("POSTGRES_PRISMA_URL");
    restoreEnvValue("POSTGRES_URL_NON_POOLING");
    restoreEnvValue("BETTER_AUTH_SECRET");

    mock.clearAllMocks();
  });

  describe("getSessionFromRequest", () => {
    test("returns null if no header and no session", async () => {
      const req = new Request("http://localhost");
      const result = await middlewareModule.getSessionFromRequest(req);
      expect(result.session).toBeNull();
      expect(result.user).toBeNull();
      expect(mockGetSession).toHaveBeenCalled();
    });

    test("falls back to auth.api.getSession if header but invalid token", async () => {
      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer invalid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);
      expect(mockFindByToken).toHaveBeenCalledWith("invalid");
      expect(mockValidateJWTToken).toHaveBeenCalledWith("invalid");
      expect(mockGetSession).toHaveBeenCalled();
      expect(result.session).toBeNull();
    });

    test("uses cached session from hybrid store", async () => {
      const now = new Date();
      mockFindByToken.mockResolvedValueOnce({
        id: "s1",
        userId: "u1",
        token: "valid",
        expiresAt: now,
        ipAddress: "127.0.0.1",
        userAgent: "ua",
        createdAt: now,
        updatedAt: now,
      });
      mockFindUnique.mockResolvedValueOnce(validUserData);

      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer valid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(mockFindByToken).toHaveBeenCalledWith("valid");
      expect(mockFindUnique).toHaveBeenCalled();
      expect(mockValidateJWTToken).not.toHaveBeenCalled();
      expect(mockGetSession).not.toHaveBeenCalled();
      expect(result.session?.id).toBe("s1");
      expect(result.user?.username).toBe("test");
    });

    test("returns null if cached session but user not found", async () => {
      const now = new Date();
      mockFindByToken.mockResolvedValueOnce({
        id: "s1",
        userId: "u1",
        token: "valid",
        expiresAt: now,
        ipAddress: "127.0.0.1",
        userAgent: "ua",
        createdAt: now,
        updatedAt: now,
      });
      mockFindUnique.mockResolvedValueOnce(null);

      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer valid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(result.session).toBeNull();
      expect(mockGetSession).toHaveBeenCalled();
    });

    test("creates new hybrid session if token is valid but uncached", async () => {
      const now = new Date();

      mockFindByToken.mockResolvedValueOnce(null);
      mockValidateJWTToken.mockResolvedValueOnce({
        valid: true,
        payload: { sub: "u1", exp: Date.now() / 1000 + 10_000 },
      });
      mockFindUnique.mockResolvedValueOnce(validUserData);
      mockCreate.mockResolvedValueOnce({
        id: "s1",
        userId: "u1",
        token: "valid",
        expiresAt: now,
        ipAddress: "127.0.0.1",
        userAgent: "ua",
        createdAt: now,
        updatedAt: now,
      });

      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer valid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(mockFindByToken).toHaveBeenCalledWith("valid");
      expect(mockValidateJWTToken).toHaveBeenCalledWith("valid");
      expect(mockFindUnique).toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalled();
      expect(result.session?.id).toBe("s1");
    });

    test("returns null if validation result has no sub", async () => {
      mockFindByToken.mockResolvedValueOnce(null);
      mockValidateJWTToken.mockResolvedValueOnce({
        valid: true,
        payload: { exp: Date.now() / 1000 + 10_000 },
      });
      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer valid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(result.session).toBeNull();
      expect(result.user).toBeNull();
    });

    test("falls through if userData is null after validation", async () => {
      mockFindByToken.mockResolvedValueOnce(null);
      mockValidateJWTToken.mockResolvedValueOnce({
        valid: true,
        payload: { sub: "u1", exp: Date.now() / 1000 + 10_000 },
      });
      mockFindUnique.mockResolvedValueOnce(null);

      // it should fall back to auth.api.getSession
      mockGetSession.mockResolvedValueOnce(null);

      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer valid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(result.session).toBeNull();
      expect(mockGetSession).toHaveBeenCalled();
    });

    test("uses auth.api.getSession as ultimate fallback and gets user data", async () => {
      mockGetSession.mockResolvedValueOnce({
        session: { id: "s2", userId: "u2" },
        user: { id: "u2" },
      });
      mockFindUnique.mockResolvedValueOnce({ username: "apiuser" });

      const req = new Request("http://localhost");
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(mockGetSession).toHaveBeenCalled();
      expect(mockFindUnique).toHaveBeenCalled();
      expect(result.session?.id).toBe("s2");
      expect(result.user?.username).toBe("apiuser");
    });

    test("catches errors and returns null", async () => {
      mockGetSession.mockImplementationOnce(() => {
        throw new Error("Oops");
      });
      const req = new Request("http://localhost");
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(result.session).toBeNull();
      expect(result.user).toBeNull();
    });
  });

  describe("requireAuth and optionalAuth", () => {
    test("requireAuth throws if unauthorized", async () => {
      const req = new Request("http://localhost");
      await expect(middlewareModule.requireAuth(req)).rejects.toThrow(
        "Unauthorized"
      );
    });

    test("requireAuth returns context if authorized", async () => {
      mockGetSession.mockResolvedValueOnce({
        session: { id: "s2", userId: "u2" },
        user: { id: "u2" },
      });
      mockFindUnique.mockResolvedValueOnce({ username: "apiuser" });

      const req = new Request("http://localhost");
      const result = await middlewareModule.requireAuth(req);

      expect(result.session?.id).toBe("s2");
    });

    test("optionalAuth acts like getSessionFromRequest", async () => {
      const req = new Request("http://localhost");
      const result = await middlewareModule.optionalAuth(req);
      expect(result.session).toBeNull();
    });
  });
});

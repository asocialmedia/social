import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { HybridSession, JWTValidationResult } from "@asm/auth/core";

import type {
  getSessionFromRequest,
  optionalAuth,
  requireAuth,
} from "./middleware";

interface MiddlewareModule {
  getSessionFromRequest: typeof getSessionFromRequest;
  optionalAuth: typeof optionalAuth;
  requireAuth: typeof requireAuth;
}

interface SessionLookupUser {
  banExpires: Date | null;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  displayName: string;
  email: string;
  emailVerified: boolean;
  name: string;
  role: string;
  updatedAt: Date;
  username: string;
}

type ApiSessionResult = {
  session: { id: string; userId: string };
  user: { id: string };
} | null;

const mockFindUnique = mock(
  (): Promise<SessionLookupUser | { username: string } | null> =>
    Promise.resolve(null)
);

const mockFindByToken = mock((): Promise<HybridSession | null> =>
  Promise.resolve(null)
);
const mockCreate = mock((): Promise<HybridSession | null> =>
  Promise.resolve(null)
);
const mockValidateJWTToken = mock((): Promise<JWTValidationResult> =>
  Promise.resolve({ valid: false })
);

const mockGetSession = mock((): Promise<ApiSessionResult> =>
  Promise.resolve(null)
);

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
      Reflect.deleteProperty(process.env, key);
      return;
    }
    process.env[key] = value;
  };

  const validUserData: SessionLookupUser = {
    banExpires: null,
    banReason: null,
    banned: false,
    createdAt: new Date(),
    displayName: "Test User",
    email: "test@example.com",
    emailVerified: true,
    name: "Test",
    role: "user",
    updatedAt: new Date(),
    username: "test",
  };

  beforeEach(async () => {
    console.error = mock(() => {}) as typeof console.error;
    console.log = mock(() => {}) as typeof console.log;
    console.warn = mock(() => {}) as typeof console.warn;

    mock.module("@asm/db", () => ({
      prisma: {
        user: {
          findUnique: mockFindUnique,
          update: mock(() => ({})),
        },
      },
    }));

    mock.module("@asm/auth/core", () => ({
      extractTokenFromHeader: (h: string | null) =>
        h ? h.replace("Bearer ", "") : null,
      hybridSessionStore: {
        create: mockCreate,
        findByToken: mockFindByToken,
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
        createdAt: now,
        expiresAt: now,
        id: "s1",
        ipAddress: "127.0.0.1",
        token: "valid",
        updatedAt: now,
        userAgent: "ua",
        userId: "u1",
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

    test("rejects cached session for a banned user", async () => {
      const now = new Date();
      mockFindByToken.mockResolvedValueOnce({
        createdAt: now,
        expiresAt: now,
        id: "s1",
        ipAddress: "127.0.0.1",
        token: "valid",
        updatedAt: now,
        userAgent: "ua",
        userId: "u1",
      });
      mockFindUnique.mockResolvedValueOnce({
        ...validUserData,
        banExpires: new Date("2030-01-01T00:00:00.000Z"),
        banReason: "Spam",
        banned: true,
      });

      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer valid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(mockFindByToken).toHaveBeenCalledWith("valid");
      expect(result.session).toBeNull();
      expect(result.user).toBeNull();
    });

    test("clears an expired ban and allows the cached session", async () => {
      const now = new Date();
      mockFindByToken.mockResolvedValueOnce({
        createdAt: now,
        expiresAt: now,
        id: "s1",
        ipAddress: "127.0.0.1",
        token: "valid",
        updatedAt: now,
        userAgent: "ua",
        userId: "u1",
      });
      mockFindUnique.mockResolvedValueOnce({
        ...validUserData,
        banExpires: new Date("2020-01-01T00:00:00.000Z"),
        banReason: "Old",
        banned: true,
      });

      const req = new Request("http://localhost", {
        headers: { authorization: "Bearer valid" },
      });
      const result = await middlewareModule.getSessionFromRequest(req);

      expect(mockFindByToken).toHaveBeenCalledWith("valid");
      expect(result.session?.id).toBe("s1");
      expect(result.user?.banned).toBe(true);
    });

    test("returns null if cached session but user not found", async () => {
      const now = new Date();
      mockFindByToken.mockResolvedValueOnce({
        createdAt: now,
        expiresAt: now,
        id: "s1",
        ipAddress: "127.0.0.1",
        token: "valid",
        updatedAt: now,
        userAgent: "ua",
        userId: "u1",
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
        payload: { exp: Date.now() / 1000 + 10_000, sub: "u1" },
        valid: true,
      });
      mockFindUnique.mockResolvedValueOnce(validUserData);
      mockCreate.mockResolvedValueOnce({
        createdAt: now,
        expiresAt: now,
        id: "s1",
        ipAddress: "127.0.0.1",
        token: "valid",
        updatedAt: now,
        userAgent: "ua",
        userId: "u1",
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
        payload: { exp: Date.now() / 1000 + 10_000 },
        valid: true,
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
        payload: { exp: Date.now() / 1000 + 10_000, sub: "u1" },
        valid: true,
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

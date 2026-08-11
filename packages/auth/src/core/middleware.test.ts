import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthContext, Session, User } from "./types";

const originalConsoleError = console.error;

interface SessionResponse {
  session: Session;
  user: User;
}

const mockGetSession = mock(async (): Promise<SessionResponse | null> => null);

const mockAuth = {
  api: {
    getSession: mockGetSession,
  },
};

mock.module("./config", () => ({ auth: mockAuth }));

import { getSessionFromRequest, optionalAuth, requireAuth } from "./middleware";

describe("middleware", () => {
  beforeEach(() => {
    console.error = mock(() => undefined) as typeof console.error;
    mockGetSession.mockClear();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("getSessionFromRequest returns null when no session", async () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer 123" },
    });
    const result = await getSessionFromRequest(req);
    expect(result.session).toBeNull();
    expect(result.user).toBeNull();
    expect(mockGetSession).toHaveBeenCalled();
  });

  test("getSessionFromRequest returns session and user", async () => {
    const sessionResponse: SessionResponse = {
      session: {
        id: "s1",
        userId: "u1",
        token: "token",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
      user: {
        id: "u1",
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
        username: "testuser",
        role: "user",
        banned: false,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    };

    mockGetSession.mockResolvedValueOnce({
      session: sessionResponse.session,
      user: sessionResponse.user,
    });
    const req = new Request("http://localhost");
    const result = await getSessionFromRequest(req);
    expect(result.session?.id).toBe("s1");
    expect(result.user?.id).toBe("u1");
  });

  test("getSessionFromRequest catches error and returns null", async () => {
    mockGetSession.mockImplementationOnce(() => {
      throw new Error("API fail");
    });
    const req = new Request("http://localhost");
    const result = await getSessionFromRequest(req);
    expect(result.session).toBeNull();
    expect(result.user).toBeNull();
  });

  test("requireAuth throws if unauthorized", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const req = new Request("http://localhost");
    await expect(requireAuth(req)).rejects.toThrow("Unauthorized");
  });

  test("requireAuth returns context if authorized", async () => {
    const authContext: AuthContext = {
      session: {
        id: "s1",
        userId: "u1",
        token: "token",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
      user: {
        id: "u1",
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
        username: "testuser",
        role: "user",
        banned: false,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    };

    mockGetSession.mockResolvedValueOnce({
      session: authContext.session as Session,
      user: authContext.user as User,
    });
    const req = new Request("http://localhost");
    const result = await requireAuth(req);
    expect(result.session?.id).toBe("s1");
    expect(result.user?.id).toBe("u1");
  });

  test("optionalAuth works like getSessionFromRequest", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const req = new Request("http://localhost");
    const result = await optionalAuth(req);
    expect(result.session).toBeNull();
  });
});

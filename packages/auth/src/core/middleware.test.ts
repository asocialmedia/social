import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { getSessionFromRequest, optionalAuth, requireAuth } from "./middleware";
import type { AuthContext, Session, User } from "./types";

const originalConsoleError = console.error;

interface SessionResponse {
  session: Session;
  user: User;
}

const mockGetSession = mock((): Promise<SessionResponse | null> =>
  Promise.resolve(null)
);

const mockAuth = {
  api: {
    getSession: mockGetSession,
  },
};

mock.module("./config", () => ({ auth: mockAuth }));

describe("middleware", () => {
  beforeEach(() => {
    console.error = mock(() => {}) as typeof console.error;
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
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        id: "s1",
        ipAddress: null,
        token: "token",
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
        userAgent: null,
        userId: "u1",
      },
      user: {
        banned: false,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        id: "u1",
        name: "Test User",
        role: "user",
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
        username: "testuser",
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
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        id: "s1",
        ipAddress: null,
        token: "token",
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
        userAgent: null,
        userId: "u1",
      },
      user: {
        banned: false,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        id: "u1",
        name: "Test User",
        role: "user",
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
        username: "testuser",
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

import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockGetSession = mock();
const mockSessionFindFirst = mock();
const mockSessionFindMany = mock();
const mockPublishSessionRevocation = mock();
const fetchMock = mock();

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/auth/auth-internal", () => ({
  authInternalHeaders: (headers: Record<string, string>) => headers,
  getAuthBaseUrl: () => "http://auth.internal",
}));

mock.module("@asm/db", () => ({
  prisma: {
    session: {
      findFirst: mockSessionFindFirst,
      findMany: mockSessionFindMany,
    },
  },
  publishSessionRevocation: mockPublishSessionRevocation,
}));

globalThis.fetch = fetchMock;

const { DELETE, GET } = await import("./route");

function revokeRequest(body: unknown): Request {
  return new Request("http://localhost/api/security/sessions", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=current-token",
    },
    method: "DELETE",
  });
}

describe("/api/security/sessions", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSessionFindFirst.mockReset();
    mockSessionFindMany.mockReset();
    mockPublishSessionRevocation.mockReset();
    fetchMock.mockReset();

    mockGetSession.mockResolvedValue({
      session: { id: "current-session" },
      user: { id: "user-1" },
    });
    mockSessionFindMany.mockResolvedValue([
      {
        country: "IN",
        createdAt: new Date("2026-09-10T00:00:00.000Z"),
        expiresAt: new Date("2026-09-17T00:00:00.000Z"),
        id: "current-session",
        ipAddress: "203.0.113.10",
        updatedAt: new Date("2026-09-10T01:00:00.000Z"),
        userAgent: "Mozilla/5.0 Chrome/140.0",
      },
    ]);
    mockSessionFindFirst.mockResolvedValue({
      id: "session-2",
      token: "private-session-token",
    });
    mockPublishSessionRevocation.mockResolvedValue();
    fetchMock.mockResolvedValue(Response.json({ status: true }));
  });

  test("lists only the authenticated user's active session metadata", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        country: "IN",
        createdAt: "2026-09-10T00:00:00.000Z",
        expiresAt: "2026-09-17T00:00:00.000Z",
        id: "current-session",
        ipAddress: "203.0.113.10",
        updatedAt: "2026-09-10T01:00:00.000Z",
        userAgent: "Mozilla/5.0 Chrome/140.0",
      },
    ]);
    expect(mockSessionFindMany).toHaveBeenCalledWith({
      orderBy: { updatedAt: "desc" },
      select: {
        country: true,
        createdAt: true,
        expiresAt: true,
        id: true,
        ipAddress: true,
        updatedAt: true,
        userAgent: true,
      },
      where: {
        expiresAt: { gt: expect.any(Date) },
        userId: "user-1",
      },
    });
  });

  test("uses a server-side token lookup before revoking one session", async () => {
    const response = await DELETE(
      revokeRequest({ action: "single", sessionId: "session-2" })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://auth.internal/api/auth/revoke-session",
      expect.objectContaining({
        body: JSON.stringify({ token: "private-session-token" }),
        method: "POST",
      })
    );
    expect(mockPublishSessionRevocation).toHaveBeenCalledWith("user-1", {
      revokedSessionId: "session-2",
    });
  });

  test("keeps destructive actions behind Better Auth's fresh-session check", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: "SESSION_NOT_FRESH" }, { status: 403 })
    );

    const response = await DELETE(revokeRequest({ action: "all" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        "For your protection, sign in again before managing signed-in devices.",
    });
    expect(mockPublishSessionRevocation).not.toHaveBeenCalled();
  });
});

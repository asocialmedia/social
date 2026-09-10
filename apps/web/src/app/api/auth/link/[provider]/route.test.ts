import { beforeEach, describe, expect, mock, test } from "bun:test";

import { NextRequest } from "next/server";

const mockGetSession = mock();
const mockUserFindUnique = mock();
const mockAccountFindFirst = mock();
const fetchMock = mock();

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  prisma: {
    account: { findFirst: mockAccountFindFirst },
    user: { findUnique: mockUserFindUnique },
  },
}));

globalThis.fetch = fetchMock;

const { GET } = await import("./route");

function linkRequest(search = "?confirmed=1"): NextRequest {
  return new NextRequest(`http://localhost/api/auth/link/google${search}`);
}

const googleContext = { params: Promise.resolve({ provider: "google" }) };

describe("GET /api/auth/link/:provider", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockUserFindUnique.mockReset();
    mockAccountFindFirst.mockReset();
    fetchMock.mockReset();

    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    mockUserFindUnique.mockResolvedValue({
      email: "member@example.com",
      emailVerified: true,
    });
    mockAccountFindFirst.mockResolvedValue({ password: "scrypt$hash" });
    fetchMock.mockResolvedValue(
      new Response(null, {
        headers: { location: "https://accounts.google.com/o/oauth2/auth" },
        status: 307,
      })
    );
  });

  test("requires an explicit confirmation before starting OAuth", async () => {
    const response = await GET(linkRequest(""), googleContext);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "account_error=link_confirmation_required"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requires a verified email and password for OAuth-only accounts", async () => {
    mockAccountFindFirst.mockResolvedValue(null);

    const response = await GET(linkRequest(), googleContext);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "account_error=link_requires_password"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("starts Better Auth's explicit link flow after the prerequisites", async () => {
    const response = await GET(linkRequest(), googleContext);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/auth"
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      callbackURL: "http://localhost/settings?account_success=google",
      errorCallbackURL:
        "http://localhost/settings?account_error=provider_flow_failed",
      provider: "google",
    });
  });
});

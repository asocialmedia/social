import { beforeEach, describe, expect, mock, test } from "bun:test";

import { NextRequest } from "next/server";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

const mockGetSession = mock();
const mockUserFindUnique = mock();
const mockAccountFindFirst = mock();
const fetchMock = mock();

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        Accounts: {
          select: () => ({ where: () => ({ first: mockAccountFindFirst }) }),
        },
        Users: {
          select: () => ({ where: () => ({ first: mockUserFindUnique }) }),
        },
      },
    },
  },
}));

globalThis.fetch = fetchMock;

const { GET, POST } = await import("./route");

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

  test("allows a signed-in OAuth-only account to link another provider", async () => {
    mockAccountFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({
      email: "id@reddit.placeholder.invalid",
      emailVerified: true,
    });
    const response = await GET(linkRequest(), googleContext);
    expect(response.status).toBe(307);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("preserves state cookies when Better Auth returns a JSON authorization URL", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          redirect: false,
          url: "https://accounts.google.com/authorize?state=fixture",
        },
        {
          headers: {
            "set-cookie": "state=fixture; Domain=auth.other.test; HttpOnly",
          },
        }
      )
    );
    const response = await GET(linkRequest(), googleContext);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("state=fixture");
    expect(response.headers.get("set-cookie")).toContain("Domain=localhost");
  });

  test("rejects unauthenticated linking before contacting the auth service", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await GET(linkRequest(), googleContext);
    expect(response.headers.get("location")).toContain(
      "account_error=unauthorized"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("starts Better Auth's explicit link flow with the existing session", async () => {
    const response = await GET(linkRequest(), googleContext);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/auth"
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      callbackURL: "http://localhost/settings?account_success=google",
      disableRedirect: false,
      errorCallbackURL:
        "http://localhost/settings?account_error=provider_flow_failed",
      provider: "google",
    });
  });
});

test("native linking uses a session-bound app callback and returns the authorization URL", async () => {
  mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    Response.json(
      {
        redirect: false,
        url: "https://www.reddit.com/api/v1/authorize?state=fixture",
      },
      { headers: { "set-cookie": "state=fixture; HttpOnly" } }
    )
  );
  const response = await POST(
    new NextRequest("http://localhost/api/auth/link/reddit?confirmed=1", {
      body: JSON.stringify({
        callbackURL: "asocialmedia:///settings?link_user=other-user",
      }),
      method: "POST",
    }),
    { params: Promise.resolve({ provider: "reddit" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    url: "https://www.reddit.com/api/v1/authorize?state=fixture",
  });
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(String(init.body)) as {
    callbackURL: string;
    disableRedirect: boolean;
  };
  expect(body.disableRedirect).toBe(true);
  expect(new URL(body.callbackURL).searchParams.get("link_user")).toBe(
    "user-1"
  );
  expect(response.headers.get("set-cookie")).toContain("state=fixture");
});

test("native linking rejects an arbitrary callback origin before starting OAuth", async () => {
  mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
  fetchMock.mockClear();
  const response = await POST(
    new NextRequest("http://localhost/api/auth/link/reddit?confirmed=1", {
      body: JSON.stringify({ callbackURL: "https://evil.example/steal" }),
      method: "POST",
    }),
    { params: Promise.resolve({ provider: "reddit" }) }
  );
  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

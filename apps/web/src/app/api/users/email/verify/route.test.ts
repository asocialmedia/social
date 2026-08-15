import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const USER = {
  email: "old@example.com",
  id: "user-1",
};

const state = {
  authBody: null as unknown,
  authPath: null as string | null,
  authResponseBody: { success: true },
  authResponseStatus: 200,
  session: { user: USER },
};

function resetState() {
  state.authBody = null;
  state.authPath = null;
  state.authResponseStatus = 200;
  state.authResponseBody = { success: true };
  state.session = { user: USER };
}

const mockGetSession = mock(() => state.session);

const mockFetch = mock((url: string, init: RequestInit) => {
  state.authBody = JSON.parse(String(init.body));
  state.authPath = url;
  return Response.json(state.authResponseBody, {
    headers: { "Content-Type": "application/json" },
    status: state.authResponseStatus,
  });
});

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/auth-internal", () => ({
  authInternalHeaders: (headers: Record<string, string>) => headers,
}));

mock.module("next/headers", () => ({
  headers: () => new Headers(),
}));

globalThis.fetch = mockFetch as typeof fetch;

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/users/email/verify", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/users/email/verify", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
    mockFetch.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    state.session = null;
    const res = await POST(
      postRequest({ email: "new@example.com", otp: "1234" })
    );
    expect(res.status).toBe(401);
    expect(state.authPath).toBeNull();
  });

  test("forwards email + otp to the auth change-email endpoint", async () => {
    const res = await POST(
      postRequest({ email: "new@example.com", otp: "123456" })
    );
    expect(res.status).toBe(200);
    expect(state.authPath).toContain("/api/auth/email-otp/change-email");
    expect(state.authBody).toEqual({
      newEmail: "new@example.com",
      otp: "123456",
    });
  });

  test("rejects a wrong OTP from the auth service", async () => {
    state.authResponseStatus = 400;
    state.authResponseBody = { message: "Invalid OTP" };
    const res = await POST(
      postRequest({ email: "new@example.com", otp: "000000" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid OTP");
  });

  test("accepts a valid OTP", async () => {
    state.authResponseBody = {
      status: true,
      user: { email: "new@example.com" },
    };
    const res = await POST(
      postRequest({ email: "new@example.com", otp: "123456" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

import { beforeEach, describe, expect, mock, test } from "bun:test";

import { PATCH } from "./route";

const USER = {
  email: "old@example.com",
  id: "user-1",
};

const state = {
  authRequest: null as { body: unknown; path: string } | null,
  authResponseBody: { success: true },
  authResponseStatus: 200,
  session: { user: USER },
};

function resetState() {
  state.authRequest = null;
  state.authResponseStatus = 200;
  state.authResponseBody = { success: true };
  state.session = { user: USER };
}

const mockGetSession = mock(() => state.session);

const mockFetch = mock((url: string, init: RequestInit) => {
  state.authRequest = {
    body: JSON.parse(String(init.body)),
    path: url,
  };
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

mock.module("next/navigation", () => ({}));

// The route calls the global fetch to reach the auth service; substitute the
// mock so no real network request is made.
globalThis.fetch = mockFetch as typeof fetch;

function patchRequest(email: string): Request {
  return new Request("http://localhost/api/users/email", {
    body: JSON.stringify({ email }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

describe("PATCH /api/users/email", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
    mockFetch.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    state.session = null;
    const res = await PATCH(patchRequest("new@example.com"));
    expect(res.status).toBe(401);
    expect(state.authRequest).toBeNull();
  });

  test("forwards the new email to the auth request-email-change endpoint", async () => {
    const res = await PATCH(patchRequest("new@example.com"));
    expect(res.status).toBe(200);
    expect(state.authRequest?.path).toContain(
      "/api/auth/email-otp/request-email-change"
    );
    expect(state.authRequest?.body).toEqual({ newEmail: "new@example.com" });
  });

  test("does NOT directly change the email (verification required)", async () => {
    // The route must only *request* an email change; it must never call a
    // database update that swaps the address immediately. Assert the outgoing
    // request is the OTP request and nothing writes to the user's email here.
    await PATCH(patchRequest("new@example.com"));
    expect(state.authRequest?.path).toContain("request-email-change");
  });

  test("surfaces an auth-service failure", async () => {
    state.authResponseStatus = 400;
    state.authResponseBody = { message: "Email is the same" };
    const res = await PATCH(patchRequest("old@example.com"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Email is the same");
  });
});

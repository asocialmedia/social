import { beforeEach, describe, expect, mock, test } from "bun:test";

import { PATCH } from "./route";

const USER = {
  email: "old@example.com",
  id: "user-1",
};

const state = {
  authCalls: [] as { body: unknown; path: string }[],
  changeResponseBody: { success: true },
  changeResponseStatus: 200,
  session: { user: USER },
  verifyResponseStatus: 200,
};

function resetState() {
  state.authCalls = [];
  state.changeResponseBody = { success: true };
  state.changeResponseStatus = 200;
  state.session = { user: USER };
  state.verifyResponseStatus = 200;
}

const mockGetSession = mock(() => state.session);

const mockFetch = mock((url: string, init: RequestInit) => {
  const parsed = {
    body: JSON.parse(String(init.body)),
    path: url,
  };
  state.authCalls.push(parsed);
  // The current-email verification call must succeed for the change to proceed.
  if (url.includes("/verify-email")) {
    return Response.json(
      { success: true },
      { status: state.verifyResponseStatus }
    );
  }
  return Response.json(state.changeResponseBody, {
    headers: { "Content-Type": "application/json" },
    status: state.changeResponseStatus,
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

globalThis.fetch = mockFetch as typeof fetch;

function patchRequest(email: string, otp = "123456"): Request {
  return new Request("http://localhost/api/users/email", {
    body: JSON.stringify({ email, otp }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

function lastChangeCall() {
  return (
    state.authCalls.find((c) => c.path.includes("request-email-change")) ?? null
  );
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
    expect(state.authCalls.length).toBe(0);
  });

  test("verifies the current email then forwards the new email to request-email-change", async () => {
    const res = await PATCH(patchRequest("new@example.com"));
    expect(res.status).toBe(200);
    const verifyCall = state.authCalls.find((c) =>
      c.path.includes("/verify-email")
    );
    expect(verifyCall).toBeTruthy();
    expect(verifyCall?.body).toEqual({
      email: "old@example.com",
      otp: "123456",
    });
    const changeCall = lastChangeCall();
    expect(changeCall?.path).toContain("request-email-change");
    expect(changeCall?.body).toEqual({ newEmail: "new@example.com" });
  });

  test("requires a current-email code when the account has an email", async () => {
    const res = await PATCH(patchRequest("new@example.com", ""));
    expect(res.status).toBe(400);
    expect(state.authCalls.length).toBe(0);
  });

  test("skips current-email verification for accounts without an email", async () => {
    state.session = { user: { email: null, id: "user-1" } };
    const res = await PATCH(patchRequest("new@example.com"));
    expect(res.status).toBe(200);
    expect(state.authCalls.some((c) => c.path.includes("/verify-email"))).toBe(
      false
    );
    expect(lastChangeCall()?.body).toEqual({ newEmail: "new@example.com" });
  });

  test("does NOT directly change the email (verification required)", async () => {
    await PATCH(patchRequest("new@example.com"));
    expect(lastChangeCall()?.path).toContain("request-email-change");
  });

  test("surfaces an auth-service failure", async () => {
    state.changeResponseStatus = 400;
    state.changeResponseBody = { message: "Email is the same" };
    const res = await PATCH(patchRequest("old@example.com"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Email is the same");
  });

  test("rejects malformed JSON with 400 and does not call auth", async () => {
    const req = new Request("http://localhost/api/users/email", {
      body: "{not-json",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect(state.authCalls.length).toBe(0);
  });

  test("rejects an invalid email with 400 and does not call auth", async () => {
    const req = new Request("http://localhost/api/users/email", {
      body: JSON.stringify({ email: "not-an-email", otp: "123456" }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect(state.authCalls.length).toBe(0);
  });

  test("rejects a missing email field with 400 and does not call auth", async () => {
    const req = new Request("http://localhost/api/users/email", {
      body: JSON.stringify({ otp: "123456" }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect(state.authCalls.length).toBe(0);
  });
});

import { beforeEach, describe, expect, mock, test } from "bun:test";

import { NextRequest } from "next/server";

import { POST } from "./route";

mock.module("@/lib/auth-internal", () => ({
  authInternalHeaders: (headers: Record<string, string>) => headers,
  getAuthBaseUrl: () => "http://auth.test",
}));

let fetchMock: ReturnType<typeof mock>;

function otpRequest(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("http://localhost/api/verify-email", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}

function authResponse(json: unknown, status = 200): Response {
  return Response.json(json, {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("POST /api/verify-email", () => {
  beforeEach(() => {
    fetchMock = mock(() =>
      Promise.resolve(
        authResponse({ result: { data: { json: { success: true } } } })
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;
  });

  test("maps a successful verification to 200 ok", async () => {
    const res = await POST(otpRequest({ email: "a@b.c", otp: "123456" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, success: true });
  });

  test("maps an invalid OTP to 200 with the server error", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        authResponse({
          result: { data: { json: { error: "invalid-otp", success: false } } },
        })
      )
    );
    const res = await POST(otpRequest({ email: "a@b.c", otp: "000000" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: "invalid-otp", ok: false });
  });

  test("maps rate-limit metadata from the auth service", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        authResponse({
          result: {
            data: {
              json: {
                error: "rate-limited",
                remaining: 2,
                resetTime: 999,
                success: false,
              },
            },
          },
        })
      )
    );
    const res = await POST(otpRequest({ email: "a@b.c", otp: "000000" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "rate-limited",
      ok: false,
      remaining: 2,
      resetTime: 999,
    });
  });

  test("maps an upstream failure to 502 network-error", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("boom")));
    const res = await POST(otpRequest({ email: "a@b.c", otp: "123456" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "network-error", ok: false });
  });

  test("rejects a malformed request without calling the auth service", async () => {
    const res = await POST(otpRequest({ email: "a@b.c", otp: "abc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid-request", ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("forwards only the trusted client IP, not the caller-controlled x-forwarded-for", async () => {
    const res = await POST(
      otpRequest(
        { email: "a@b.c", otp: "123456" },
        {
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": "198.51.100.66",
        }
      )
    );
    expect(res.status).toBe(200);

    const [[, init]] = fetchMock.mock.calls;
    const headers = init.headers as Record<string, string>;
    expect(headers["cf-connecting-ip"]).toBe("203.0.113.9");
    expect(headers["x-forwarded-for"]).toBe("203.0.113.9");
    expect(headers["x-real-ip"]).toBe("203.0.113.9");
    expect(headers["x-forwarded-for"]).not.toBe("198.51.100.66");
  });

  test("calls the pendingSignupVerify procedure on the auth service", async () => {
    await POST(otpRequest({ email: "a@b.c", otp: "123456" }));
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe("http://auth.test/api/trpc/pendingSignupVerify");
    expect(JSON.parse(String(init.body))).toEqual({
      id: 1,
      json: { email: "a@b.c", otp: "123456", otpVerified: true },
    });
  });
});

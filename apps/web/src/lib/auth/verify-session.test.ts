import { describe, expect, test } from "bun:test";

import { hasBearerToken, hasSessionCookie } from "./session-credentials";
import { hasVerifiedSession } from "./verify-session";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: { "content-type": "application/json" },
    status,
  });
}

const AUTH_URL = "http://localhost:3001/api/auth/get-session";

describe("hasSessionCookie", () => {
  test("sees the session cookie through every prefix better-auth uses", () => {
    expect(hasSessionCookie("better-auth.session_token=abc123")).toBe(true);
    expect(hasSessionCookie("__Secure-better-auth.session_token=abc")).toBe(
      true
    );
    expect(hasSessionCookie("foo=bar; session_token=xyz")).toBe(true);
  });

  test("is false for a cookie jar with no session in it", () => {
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("other_cookie=value")).toBe(false);
    expect(hasSessionCookie("session=123")).toBe(false);
  });
});

describe("hasBearerToken", () => {
  test("accepts a Bearer value in any case", () => {
    expect(hasBearerToken("Bearer my-token-123")).toBe(true);
    expect(hasBearerToken("bearer my-token-123")).toBe(true);
  });

  test("rejects an absent, empty or differently-schemed credential", () => {
    expect(hasBearerToken("")).toBe(false);
    expect(hasBearerToken("Bearer ")).toBe(false);
    expect(hasBearerToken("Basic user:pass")).toBe(false);
    expect(hasBearerToken("Bearer")).toBe(false);
  });
});

describe("hasVerifiedSession", () => {
  test("is true only when the auth service resolves a live session", async () => {
    const calls: string[] = [];
    const baseFetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(
        jsonResponse({ session: { id: "s1" }, user: { id: "u1" } })
      );
    }) as unknown as typeof fetch;

    const verified = await hasVerifiedSession({
      authorization: "Bearer real",
      baseFetch,
      cookie: "better-auth.session_token=real",
    });

    expect(verified).toBe(true);
    expect(calls[0]).toBe(AUTH_URL);
  });

  test("is false when the service answers with no session", async () => {
    const baseFetch = (() =>
      Promise.resolve(jsonResponse(null))) as unknown as typeof fetch;
    expect(
      await hasVerifiedSession({ authorization: "Bearer nope", baseFetch })
    ).toBe(false);
  });

  test("is false when the service rejects the credential", async () => {
    const baseFetch = (() =>
      Promise.resolve(
        jsonResponse({ error: "unauthorized" }, 401)
      )) as unknown as typeof fetch;
    expect(
      await hasVerifiedSession({ authorization: "Bearer nope", baseFetch })
    ).toBe(false);
  });

  test("is false, and never throws, when the service is unreachable", async () => {
    // A gate must narrow when its dependency is down, never widen. A false here
    // costs the caller one fallback credential check; a true would cost a
    // security boundary.
    const baseFetch = (() =>
      Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    expect(
      await hasVerifiedSession({ authorization: "Bearer real", baseFetch })
    ).toBe(false);
  });

  test("is false, and never throws, on an unparseable body", async () => {
    const baseFetch = (() =>
      Promise.resolve(
        new Response("<html>502</html>", {
          headers: { "content-type": "text/html" },
          status: 200,
        })
      )) as unknown as typeof fetch;
    expect(
      await hasVerifiedSession({ authorization: "Bearer real", baseFetch })
    ).toBe(false);
  });

  test("never calls the service when there is nothing to verify", async () => {
    let called = false;
    const baseFetch = (() => {
      called = true;
      return Promise.resolve(jsonResponse({ session: {} }));
    }) as unknown as typeof fetch;

    expect(await hasVerifiedSession({ baseFetch })).toBe(false);
    expect(called).toBe(false);
  });
});

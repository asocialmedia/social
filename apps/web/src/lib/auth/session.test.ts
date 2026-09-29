import { describe, expect, test } from "bun:test";

import { hasBearerToken, hasSessionCookie } from "./session";

describe("hasSessionCookie", () => {
  test("returns true when cookie has session_token=", () => {
    expect(hasSessionCookie("better-auth.session_token=abc123")).toBe(true);
    expect(hasSessionCookie("__Secure-better-auth.session_token=abc123")).toBe(
      true
    );
    expect(hasSessionCookie("foo=bar; session_token=xyz")).toBe(true);
  });

  test("returns false when session_token is absent", () => {
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("other_cookie=value")).toBe(false);
    expect(hasSessionCookie("session=123")).toBe(false);
  });
});

describe("hasBearerToken", () => {
  test("returns true for valid Bearer token", () => {
    expect(hasBearerToken("Bearer my-token-123")).toBe(true);
    expect(hasBearerToken("bearer my-token-123")).toBe(true);
  });

  test("returns false for invalid or empty Bearer token", () => {
    expect(hasBearerToken("")).toBe(false);
    expect(hasBearerToken("Bearer ")).toBe(false);
    expect(hasBearerToken("Basic user:pass")).toBe(false);
    expect(hasBearerToken("Bearer")).toBe(false);
  });
});

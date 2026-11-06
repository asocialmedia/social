import { describe, expect, test } from "bun:test";

import { extractSessionToken, withAuthHeaders } from "./auth-headers";

describe("auth-headers", () => {
  test("extracts session token from standard better-auth cookie", () => {
    const cookie = "better-auth.session_token=test_tok_12345; other=value";
    expect(extractSessionToken(cookie)).toBe("test_tok_12345");
  });

  test("extracts session token from __Secure- cookie", () => {
    const cookie = "__Secure-better-auth.session_token=secure_tok_67890";
    expect(extractSessionToken(cookie)).toBe("secure_tok_67890");
  });

  test("extracts session token from simple session_token cookie", () => {
    const cookie = "foo=bar; session_token=simple_tok_abc";
    expect(extractSessionToken(cookie)).toBe("simple_tok_abc");
  });

  test("returns null when no session token is in cookie", () => {
    expect(extractSessionToken()).toBeNull();
    expect(extractSessionToken("")).toBeNull();
    expect(extractSessionToken("foo=bar; other=baz")).toBeNull();
  });

  test("attaches cookie and authorization header when session token present", () => {
    const headers = withAuthHeaders(
      { "content-type": "application/json" },
      "better-auth.session_token=secret_token"
    );
    expect(headers.cookie).toBe("better-auth.session_token=secret_token");
    expect(headers.authorization).toBe("Bearer secret_token");
    expect(headers["content-type"]).toBe("application/json");
  });

  test("does not overwrite explicit authorization header", () => {
    const headers = withAuthHeaders(
      { authorization: "Bearer explicit_tok" },
      "better-auth.session_token=secret_token"
    );
    expect(headers.authorization).toBe("Bearer explicit_tok");
  });
});
